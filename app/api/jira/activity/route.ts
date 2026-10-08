import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { cached, isAdminRequest, jiraConfigured, extractJiraKeys, JIRA_PROJECTS } from '@/lib/jira';
import { emptyCounts, eventsFromIssues, fetchIssuesWithChangelog, type IssueMeta } from '@/lib/jira-activity';
import type { ActivityEvent, ActivityResponse } from '@/lib/tickets-types';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const DEPLOY_SQL = `SELECT id, environment, status, branch, version, frontend_branch, backend_branch, deployed_by, ticket_link, notes, started_at
  FROM deployments
  WHERE started_at >= NOW() - ($1::int * INTERVAL '1 day')
    AND status ~* '(^|\\s)success$'
    AND (deployed_by IS NULL OR deployed_by NOT LIKE '%Deployment Tracker%')
  ORDER BY started_at DESC LIMIT 400`;

// GET /api/jira/activity?days=7&limit=300  (admin session required)
export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Admin login required' }, { status: 401 });
  const sp = new URL(request.url).searchParams;
  const days = Math.min(Math.max(parseInt(sp.get('days') || '7', 10) || 7, 1), 30);
  const limit = Math.min(Math.max(parseInt(sp.get('limit') || '300', 10) || 300, 1), 300);
  if (!jiraConfigured()) {
    const res: ActivityResponse = { generatedAt: new Date().toISOString(), configured: false, days, events: [], counts: emptyCounts(), truncated: false, jiraError: null };
    return NextResponse.json(res);
  }
  const fresh = sp.get('fresh') === '1';
  try {
    const payload = await cached<ActivityResponse>(`activity:${days}:${limit}`, 60000, fresh, async () => {
      const now = Date.now();
      const sinceMs = now - days * 86400000;
      let jiraError: string | null = null;
      let events: ActivityEvent[] = [];
      let meta = new Map<string, IssueMeta>();

      if (JIRA_PROJECTS.length) {
        try {
          const proj = `project in (${JIRA_PROJECTS.join(',')})`;
          const issues = await fetchIssuesWithChangelog(`${proj} AND updated >= -${days}d ORDER BY updated DESC`, 150);
          ({ events, meta } = eventsFromIssues(issues, sinceMs));
        } catch (e) {
          jiraError = e instanceof Error ? e.message : String(e);
        }
      } else {
        jiraError = 'Set JIRA_PROJECT_KEYS';
      }

      try {
        const { rows } = await pool.query(DEPLOY_SQL, [days]);
        for (const d of rows) {
          const at = new Date(d.started_at).toISOString();
          const link = typeof d.ticket_link === 'string' && /^https?:\/\//i.test(d.ticket_link) ? d.ticket_link : null;
          for (const key of extractJiraKeys(d.notes, d.branch, d.version, d.frontend_branch, d.backend_branch, d.ticket_link)) {
            const m = meta.get(key);
            events.push({
              id: `deploy:${d.id}:${key}`, at, kind: 'deploy', key, title: m?.title || '', issueType: m?.issueType || null, priority: m?.priority || null,
              actor: d.deployed_by || null, from: null, to: null, text: null, env: d.environment || null, url: link,
            });
          }
        }
      } catch (e) {
        console.error('activity deployments query failed:', e instanceof Error ? e.message : e);
      }

      const seen = new Set<string>();
      const merged = events
        .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
        .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
      const truncated = merged.length > limit;
      const out = merged.slice(0, limit);
      const counts = emptyCounts();
      for (const e of out) counts[e.kind]++;
      return { generatedAt: new Date(now).toISOString(), configured: true, days, events: out, counts, truncated, jiraError };
    });
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
