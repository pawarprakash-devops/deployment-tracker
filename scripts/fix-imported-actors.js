#!/usr/bin/env node
const { execSync } = require('child_process');
const { Pool } = require('pg');

const REPO = 'vidaisolutions/vidai-devops';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  connectionTimeoutMillis: 15000,
});

function runId(ticketLink) {
  const m = /actions\/runs\/(\d+)$/.exec(ticketLink || '');
  return m ? m[1] : null;
}

function actorOf(runId) {
  const cmd = `gh api repos/${REPO}/actions/runs/${runId} --jq '.actor.login'`;
  try {
    const out = execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    const login = out.trim();
    return login === 'null' || !login ? null : login;
  } catch (e) {
    console.error(`  !! gh api failed for ${runId}`);
    return null;
  }
}

async function main() {
  const res = await pool.query("SELECT id, ticket_link FROM deployments WHERE requested_by = 'vidai-devops'");
  console.log(`rows to fix: ${res.rows.length}`);
  let updated = 0, failed = 0;
  for (const row of res.rows) {
    const id = runId(row.ticket_link);
    if (!id) { failed++; continue; }
    const actor = actorOf(id);
    if (!actor) { failed++; console.error(`  ? no actor for ${row.ticket_link}`); continue; }
    await pool.query('UPDATE deployments SET requested_by = $1, updated_at = NOW() WHERE id = $2', [actor, row.id]);
    updated++;
    if (updated % 50 === 0) console.log(`  progress: ${updated}`);
  }
  console.log(`done. updated=${updated} failed=${failed}`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error(e.message); await pool.end(); process.exit(1); });