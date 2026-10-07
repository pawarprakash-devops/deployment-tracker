import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { extractJiraKeys, isAdminRequest, jiraConfigured, jiraIssuesByKeys } from '@/lib/jira';

export const dynamic = 'force-dynamic';

// GET /api/jira/deployed  (admin session required)
// Which Jira tickets reached which environment: keys are parsed from the notes, branches, version and
// ticket link of the last 300 successful deployments; each key lists every environment it was seen in.
export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Admin login required' }, { status: 401 });
  try {
    const { rows } = await pool.query(
      `SELECT environment, branch, version, frontend_branch, backend_branch, ticket_link, notes, started_at
       FROM deployments WHERE status = 'Success' ORDER BY started_at DESC LIMIT 300`
    );
    const seen: Record<string, Record<string, string>> = {}; // key -> env -> latest deploy time
    for (const d of rows) {
      for (const key of extractJiraKeys(d.notes, d.branch, d.version, d.frontend_branch, d.backend_branch, d.ticket_link)) {
        seen[key] ??= {};
        seen[key][d.environment] ??= d.started_at; // rows are newest-first
      }
    }
    const keys = Object.keys(seen);
    let issues = {};
    let jiraError: string | undefined;
    if (jiraConfigured() && keys.length) {
      try { issues = await jiraIssuesByKeys(keys); } catch (e) { jiraError = e instanceof Error ? e.message : String(e); }
    }
    return NextResponse.json(
      { configured: jiraConfigured(), jiraError, tickets: keys.map((key) => ({ key, environments: seen[key] })), issues },
      { headers: { 'Cache-Control': 'private, max-age=60' } }
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
