#!/usr/bin/env node
const { execSync } = require('child_process');
const { Pool } = require('pg');

const REPO = 'vidaisolutions/vidai-devops';
const SINCE = process.env.SINCE || '2026-06-07';
const WORKFLOWS = [
  { file: 'full_deployment_v2(with logs).yaml', env: 'from-cluster' },
  { file: 'prod_deployment.yaml', env: 'Production (Ankura)' },
  { file: 'prod-account-full-deploy.yaml', env: 'Production (Neotia/Babyjoy)' },
  { file: 'lms_deployment.yaml', env: 'LMS' },
];

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  connectionTimeoutMillis: 15000,
});

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

function parseTitle(title, workflowEnv) {
  if (!title) return { cluster: null, deployType: 'unknown', tag: '', branch: '', parseIssue: true };
  const clusterMatch = title.match(/Cluster\s*\[([^\]]*)\]/i) || title.match(/\[([^\]]*)\]/);
  const typeMatch = title.match(/(?:Deploy type|Type)\s*:\s*(\w+)/i);
  const tagMatch = title.match(/Tag\s*:\s*([^\s]*)/i);
  const branchMatch = title.match(/(?:Frontend Branch|Frontend)\s*:\s*(.+)$/i);
  const cluster = clusterMatch ? clusterMatch[1].trim() : null;
  const deployType = typeMatch ? typeMatch[1].toLowerCase() : 'unknown';
  const tag = tagMatch ? tagMatch[1].trim() : '';
  const branch = branchMatch ? branchMatch[1].trim() : '';
  let environment = workflowEnv;
  if (workflowEnv === 'from-cluster') environment = mapClusterToEnvironment(cluster);
  return { cluster, deployType, tag, branch, environment };
}

function mapStatus(conclusion) {
  if (conclusion === 'success') return 'Success';
  if (conclusion === 'cancelled') return 'Cancelled';
  return 'Failed';
}

function fetchRuns(workflowFile) {
  const cmd = `gh run list --repo ${REPO} --workflow "${workflowFile}" --created ">=${SINCE}" --limit 1000 ` +
    `--json databaseId,conclusion,displayTitle,createdAt,updatedAt,headBranch,event --jq '.[]'`;
  try {
    const out = execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
    if (!out.trim()) return [];
    return out.trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.event === 'workflow_dispatch');
  } catch (e) {
    console.error(`  !! error listing ${workflowFile}: ${e.message}`);
    return [];
  }
}

async function ensureEnvironment(name) {
  const res = await pool.query('SELECT id FROM environments WHERE name = $1', [name]);
  if (res.rows.length) return;
  const ord = await pool.query('SELECT COALESCE(MAX(display_order),0)+1 AS n FROM environments');
  const isProd = /production/i.test(name);
  await pool.query(
    'INSERT INTO environments (name, is_production, display_order) VALUES ($1, $2, $3)',
    [name, isProd, ord.rows[0].n]
  );
  console.log(`  + environment: ${name}${isProd ? ' (production)' : ''}`);
}

async function exists(ticketLink) {
  const res = await pool.query('SELECT 1 FROM deployments WHERE ticket_link = $1', [ticketLink]);
  return res.rows.length > 0;
}

async function insert(row) {
  const assignedBranch = (t) => (row.deployType === 'both_frontend_and_backend' || row.deployType === t) ? row.branch : null;
  const assignedVersion = (t) => (row.deployType === 'both_frontend_and_backend' || row.deployType === t) ? row.version : null;
  await pool.query(
    `INSERT INTO deployments (
      environment, status, deployment_type, branch, version,
      frontend_branch, backend_branch, frontend_version, backend_version,
      requested_by, deployed_by, ticket_link, notes,
      started_at, completed_at, duration_seconds
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      row.environment, row.status, 'standard', row.branch, row.version,
      assignedBranch('frontend'), assignedBranch('backend'),
      assignedVersion('frontend'), assignedVersion('backend'),
      row.requestedBy, 'GitHub Actions', row.ticketLink, row.notes,
      row.startedAt, row.completedAt, row.durationSeconds,
    ]
  );
}

async function main() {
  console.log(`Importing vidai-devops deployment runs since ${SINCE}`);
  let imported = 0, skipped = 0, failed = 0;
  for (const { file, env } of WORKFLOWS) {
    console.log(`\n== ${file} ==`);
    const runs = fetchRuns(file);
    console.log(`  runs: ${runs.length}`);
    for (const run of runs) {
      const parsed = parseTitle(run.displayTitle, env);
      if (parsed.parseIssue) console.warn(`  ! unparsed title (run ${run.databaseId}): ${run.displayTitle}`);
      const started = new Date(run.createdAt);
      const completed = new Date(run.updatedAt);
      const row = {
        environment: parsed.environment,
        status: mapStatus(run.conclusion),
        deployType: parsed.deployType,
        branch: parsed.branch,
        version: parsed.tag,
        requestedBy: 'vidai-devops',
        ticketLink: `https://github.com/${REPO}/actions/runs/${run.databaseId}`,
        notes: `Component: ${parsed.deployType} · Pipeline: ${file}`,
        startedAt: run.createdAt,
        completedAt: run.updatedAt,
        durationSeconds: Math.floor((completed - started) / 1000),
      };
      try {
        await ensureEnvironment(row.environment);
        if (await exists(row.ticketLink)) { skipped++; continue; }
        await insert(row);
        console.log(`  + [${row.environment}] ${row.status} ${parsed.deployType} ${run.databaseId}`);
        imported++;
      } catch (e) {
        failed++;
        console.error(`  x ${run.databaseId}: ${e.message.split('\n')[0]}`);
      }
    }
  }
  console.log(`\nDone. imported=${imported} skipped=${skipped} failed=${failed}`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error(e.message); await pool.end(); process.exit(1); });