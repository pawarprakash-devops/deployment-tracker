import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { canReadJira, jiraConfigured, jiraIssuesByKeys, ticketDeploys } from '@/lib/jira';

export const dynamic = 'force-dynamic';

// GET /api/jira/deployed  (admin session required)
// Which Jira tickets reached which environment (keys parsed from the last 300 successful deployments).
export async function GET(request: NextRequest) {
  if (!canReadJira(request)) return NextResponse.json({ error: 'Admin login required' }, { status: 401 });
  try {
    const seen = await ticketDeploys(pool);
    const keys = Object.keys(seen);
    let issues = {};
    let jiraError: string | undefined;
    if (jiraConfigured() && keys.length) {
      try { issues = await jiraIssuesByKeys(keys); } catch (e) { jiraError = e instanceof Error ? e.message : String(e); }
    }
    return NextResponse.json(
      {
        configured: jiraConfigured(), jiraError, issues,
        tickets: keys.map((key) => ({ key, environments: Object.fromEntries(Object.entries(seen[key]).map(([env, v]) => [env, v.last])) })),
      },
      { headers: { 'Cache-Control': 'private, max-age=60' } }
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
