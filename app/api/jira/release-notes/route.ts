import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { extractJiraKeys, canReadJira, jiraConfigured, jiraIssuesByKeys } from '@/lib/jira';

export const dynamic = 'force-dynamic';

const text = (d: any) => [d.notes, d.branch, d.version, d.frontend_branch, d.backend_branch, d.ticket_link];

// GET /api/jira/release-notes            -> recent deployments that reference Jira tickets (for a picker)
// GET /api/jira/release-notes?id=<uuid>  -> release notes (markdown + tickets) for one deployment
export async function GET(request: NextRequest) {
  if (!canReadJira(request)) return NextResponse.json({ error: 'Admin login required' }, { status: 401 });
  try {
    const id = new URL(request.url).searchParams.get('id');
    if (!id) {
      const { rows } = await pool.query(
        `SELECT id, environment, status, branch, version, started_at, notes, ticket_link, frontend_branch, backend_branch
         FROM deployments WHERE status = 'Success' ORDER BY started_at DESC LIMIT 200`);
      const list = rows.map((d) => ({ id: d.id, environment: d.environment, branch: d.branch, version: d.version, started_at: d.started_at, keys: extractJiraKeys(...text(d)) }))
        .filter((d) => d.keys.length).slice(0, 40);
      return NextResponse.json({ deployments: list });
    }
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });
    const { rows } = await pool.query('SELECT * FROM deployments WHERE id = $1', [id]);
    if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const d = rows[0];
    const keys = extractJiraKeys(...text(d));
    const issues = jiraConfigured() ? await jiraIssuesByKeys(keys) : {};
    const when = new Date(d.started_at).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    const lines = keys.map((k) => { const i = issues[k]; return i ? `- [${k}](${i.url}) ${i.summary} _(${i.type}, ${i.status})_` : `- ${k}`; });
    const markdown = `## ${d.environment} release — ${when}\n${d.version ? `Version: \`${d.version}\`  \n` : ''}${d.branch ? `Branch: \`${d.branch}\`  \n` : ''}\n### Tickets (${keys.length})\n${lines.join('\n') || '_No Jira tickets referenced._'}\n`;
    return NextResponse.json({ deployment: { id: d.id, environment: d.environment, version: d.version, branch: d.branch, started_at: d.started_at }, tickets: keys.map((k) => issues[k] || { key: k }), markdown });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
