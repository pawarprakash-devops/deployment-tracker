#!/usr/bin/env node

/**
 * Historical Deployment Data Importer
 * 
 * This script imports historical deployment data from GitHub Actions workflow runs
 * into the deployment tracker database.
 * 
 * Usage:
 *   node scripts/import-history.js [--since YYYY-MM-DD] [--dry-run]
 */

const { execSync } = require('child_process');
const https = require('https');

// Configuration
const GITHUB_REPO = 'vidaisolutions/vidai-devops';
const WORKFLOWS = [
  'full_deployment_v2(with logs).yaml',
  'lms_deployment.yaml',
  'prod_deployment.yaml',
  'prod-account-full-deploy.yaml',
];

const WEBHOOK_URL = process.env.TRACKER_WEBHOOK_URL || 'https://deployment-tracker-taupe.vercel.app/api/webhook';
const WEBHOOK_SECRET = process.env.TRACKER_WEBHOOK_SECRET;

// Parse command line args
const args = process.argv.slice(2);
const sinceDate = args.find(arg => arg.startsWith('--since='))?.split('=')[1] || '2026-08-24';
const dryRun = args.includes('--dry-run');

// Environment mapping
function mapClusterToEnvironment(cluster) {
  if (!cluster) return 'Other';
  if (cluster.includes('qa-aps')) return 'QA';
  if (cluster.includes('stage')) return 'Stage';
  if (cluster.includes('preview-99999')) return 'Preview';
  if (cluster.includes('pre-prod-usw')) return 'Pre-Prod USW';
  if (cluster.includes('pre-prod')) return 'Pre-Prod';
  if (cluster.includes('production') || cluster.includes('prod-refera')) return 'Production';
  if (cluster.includes('lms')) return 'LMS';
  return 'Other';
}

function mapWorkflowToType(workflowName) {
  if (workflowName.includes('lms')) return 'LMS';
  if (workflowName.includes('prod-account')) return 'Neotia/Babyjoy';
  if (workflowName.includes('prod_deployment')) return 'Ankura Prod';
  return 'Standard';
}

async function sendToWebhook(deployment) {
  if (!WEBHOOK_SECRET) {
    console.error('❌ TRACKER_WEBHOOK_SECRET not set');
    return false;
  }

  return new Promise((resolve) => {
    const data = JSON.stringify(deployment);
    const url = new URL(WEBHOOK_URL);

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'Authorization': `Bearer ${WEBHOOK_SECRET}`,
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 201) {
          resolve(true);
        } else {
          console.error(`❌ Failed: ${res.statusCode} - ${body}`);
          resolve(false);
        }
      });
    });

    req.on('error', (error) => {
      console.error('❌ Request error:', error.message);
      resolve(false);
    });

    req.write(data);
    req.end();
  });
}

async function fetchWorkflowRuns(workflow, since) {
  console.log(`\n📥 Fetching runs for ${workflow}...`);
  
  try {
    const cmd = `gh run list --repo ${GITHUB_REPO} --workflow "${workflow}" --created ">=${since}" --limit 100 --json databaseId,conclusion,displayTitle,createdAt,updatedAt,headBranch --jq '.[]'`;
    const output = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    
    if (!output.trim()) {
      console.log('  No runs found');
      return [];
    }

    const runs = output.trim().split('\n').map(line => JSON.parse(line));
    console.log(`  Found ${runs.length} runs`);
    return runs;
  } catch (error) {
    console.error(`  ❌ Error fetching runs: ${error.message}`);
    return [];
  }
}

async function getWorkflowInputs(runId) {
  try {
    const cmd = `gh run view ${runId} --repo ${GITHUB_REPO} --json jobs --jq '.jobs[0].steps[] | select(.name == "Load cluster variables") | .conclusion'`;
    execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    
    // Try to extract cluster from run logs
    const logCmd = `gh run view ${runId} --repo ${GITHUB_REPO} --log 2>/dev/null | grep -m1 "Cluster:" | sed 's/.*Cluster: //' || echo ""`;
    const cluster = execSync(logCmd, { encoding: 'utf-8' }).trim();
    
    return { cluster };
  } catch (error) {
    return { cluster: null };
  }
}

async function importHistoricalData() {
  console.log('🚀 Historical Deployment Data Importer');
  console.log(`📅 Importing deployments since: ${sinceDate}`);
  console.log(`🔗 Webhook URL: ${WEBHOOK_URL}`);
  console.log(`${dryRun ? '🧪 DRY RUN MODE - No data will be sent' : '✅ LIVE MODE - Data will be imported'}\n`);

  let totalImported = 0;
  let totalFailed = 0;

  for (const workflow of WORKFLOWS) {
    const runs = await fetchWorkflowRuns(workflow, sinceDate);
    
    for (const run of runs) {
      const status = run.conclusion === 'success' ? 'Success' : 
                     run.conclusion === 'failure' ? 'Failed' : 
                     run.conclusion === 'cancelled' ? 'Cancelled' : 'Failed';
      
      // Try to get more details
      const inputs = await getWorkflowInputs(run.databaseId);
      const environment = mapClusterToEnvironment(inputs.cluster);
      const workflowType = mapWorkflowToType(workflow);
      
      // Calculate duration
      const startedAt = new Date(run.createdAt);
      const completedAt = new Date(run.updatedAt);
      const durationSeconds = Math.floor((completedAt - startedAt) / 1000);

      const deployment = {
        environment,
        status,
        deployment_type: 'standard',
        branch: run.headBranch,
        version: run.headBranch || 'historical',
        requested_by: 'historical-import',
        deployed_by: `GitHub Actions - ${workflowType}`,
        ticket_link: `https://github.com/${GITHUB_REPO}/actions/runs/${run.databaseId}`,
        notes: `Historical import: ${run.displayTitle?.substring(0, 100)}`,
        started_at: run.createdAt,
        completed_at: run.updatedAt,
        duration_seconds: durationSeconds,
      };

      console.log(`  ${status === 'Success' ? '✅' : '❌'} ${environment.padEnd(15)} ${run.headBranch?.padEnd(20).substring(0, 20) || 'unknown'.padEnd(20)} ${new Date(run.createdAt).toLocaleDateString()}`);

      if (!dryRun) {
        const success = await sendToWebhook(deployment);
        if (success) {
          totalImported++;
        } else {
          totalFailed++;
        }
        // Rate limit: wait 100ms between requests
        await new Promise(resolve => setTimeout(resolve, 100));
      } else {
        totalImported++;
      }
    }
  }

  console.log(`\n✅ Import complete!`);
  console.log(`   Imported: ${totalImported}`);
  if (!dryRun && totalFailed > 0) {
    console.log(`   Failed: ${totalFailed}`);
  }
}

// Run the importer
importHistoricalData().catch(console.error);
