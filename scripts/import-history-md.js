#!/usr/bin/env node

/**
 * Import historical deployments from DEPLOYMENT-HISTORY-2026-08-24.md
 * Simplified version using fetch
 */

const fs = require('fs');

const WEBHOOK_URL = process.env.TRACKER_WEBHOOK_URL || 'https://deployment-tracker-taupe.vercel.app/api/webhook';
const WEBHOOK_SECRET = process.env.TRACKER_WEBHOOK_SECRET || '938d0036dc1c8b1d7588a542210560c88b9c6fdc57af47f15600630f12fc2a25';
const HISTORY_FILE = '/home/pawarpr/Desktop/WSL-Backup/DEPLOYMENT-HISTORY-2026-08-24.md';

// Parse IST date to ISO string
function parseISTDate(dateStr) {
  // Format: "24 Aug 2026 14:45"
  const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const parts = dateStr.match(/(\d+)\s+(\w+)\s+(\d+)\s+(\d+):(\d+)/);
  if (!parts) return null;
  
  const [, day, month, year, hour, minute] = parts;
  // IST is UTC+5:30 - Convert to UTC
  let utcHour = parseInt(hour) - 5;
  let utcMinute = parseInt(minute) - 30;
  let utcDay = parseInt(day);
  
  if (utcMinute < 0) {
    utcMinute += 60;
    utcHour -= 1;
  }
  if (utcHour < 0) {
    utcHour += 24;
    utcDay -= 1;
  }
  
  const date = new Date(Date.UTC(
    parseInt(year),
    months[month],
    utcDay,
    utcHour,
    utcMinute
  ));
  
  return date.toISOString();
}

function mapStatus(status) {
  if (status === 'success') return 'Success';
  if (status === 'failure') return 'Failed';
  if (status === 'cancelled') return 'Cancelled';
  return 'Success';
}

async function sendToWebhook(deployment) {
  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${WEBHOOK_SECRET}`,
      },
      body: JSON.stringify(deployment),
    });

    if (response.ok) {
      return true;
    } else {
      const text = await response.text();
      console.error(`\n   ❌ ${response.status}: ${text.substring(0, 100)}`);
      return false;
    }
  } catch (error) {
    console.error(`\n   ❌ Error: ${error.message}`);
    return false;
  }
}

async function parseAndImport() {
  const content = fs.readFileSync(HISTORY_FILE, 'utf-8');
  const lines = content.split('\n');
  
  let currentEnv = null;
  let totalImported = 0;
  let totalFailed = 0;
  let batch = [];
  
  console.log('🚀 Historical Deployment Importer');
  console.log(`📄 Reading: ${HISTORY_FILE}`);
  console.log(`🔗 Webhook: ${WEBHOOK_URL}\n`);
  
  // First collect all deployments
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Detect environment sections
    if (line.startsWith('## ')) {
      currentEnv = line.replace('## ', '').trim();
      continue;
    }
    
    // Parse table rows (skip header and separator)
    if (line.startsWith('|') && !line.includes('When (IST)') && !line.includes('---|')) {
      const parts = line.split('|').map(p => p.trim()).filter(p => p);
      
      if (parts.length >= 6 && currentEnv) {
        const [dateStr, component, branch, version, status, triggeredBy, pipeline] = parts;
        
        const startedAt = parseISTDate(dateStr);
        if (!startedAt) continue;
        
        batch.push({
          environment: currentEnv,
          status: mapStatus(status),
          deployment_type: 'standard',
          branch: branch === '—' ? null : branch,
          version: version === '—' ? null : version,
          requested_by: triggeredBy,
          deployed_by: 'GitHub Actions',
          ticket_link: null,
          notes: `Component: ${component} · Pipeline: ${pipeline || 'Unknown'}`,
          started_at: startedAt,
          dateStr,
          rawStatus: status,
        });
      }
    }
  }
  
  console.log(`📦 Found ${batch.length} deployments to import\n`);
  
  // Import in batches
  for (let i = 0; i < batch.length; i++) {
    const deployment = batch[i];
    const { dateStr, rawStatus, ...payload } = deployment;
    
    const icon = rawStatus === 'success' ? '✅' : rawStatus === 'failure' ? '❌' : '⚠️ ';
    process.stdout.write(`${icon} [${i+1}/${batch.length}] ${deployment.environment.padEnd(15)} ${(deployment.branch || 'unknown').substring(0, 20).padEnd(20)} ${dateStr.padEnd(20)} `);
    
    const success = await sendToWebhook(payload);
    if (success) {
      totalImported++;
      console.log('✓');
    } else {
      totalFailed++;
      console.log('✗');
    }
    
    // Rate limit: wait 120ms between requests
    await new Promise(resolve => setTimeout(resolve, 120));
  }
  
  console.log(`\n✅ Import complete!`);
  console.log(`   Imported: ${totalImported}`);
  console.log(`   Failed: ${totalFailed}`);
  console.log(`\n📊 Check your tracker: https://deployment-tracker-taupe.vercel.app`);
}

parseAndImport().catch(console.error);
