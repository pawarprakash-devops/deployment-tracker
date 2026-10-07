import { NextRequest, NextResponse } from 'next/server';
import { cached, filterJql, isAdminRequest, jiraConfigured, jiraCount, jiraSearch, JIRA_PROJECTS } from '@/lib/jira';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const SORTS: Record<string, string> = {
  updated: 'updated DESC', created: 'created DESC', oldest: 'created ASC', priority: 'priority DESC, updated DESC', idle: 'updated ASC',
};

// GET /api/jira/search?<filters>&sort=updated|created|oldest|priority|idle&limit=100  (admin session required)
// Ticket explorer: the filtered issue list plus the total match count.
export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Admin login required' }, { status: 401 });
  if (!jiraConfigured()) return NextResponse.json({ configured: false });
  if (!JIRA_PROJECTS.length) return NextResponse.json({ configured: true, error: 'Set JIRA_PROJECT_KEYS' }, { status: 400 });
  try {
    const sp = new URL(request.url).searchParams;
    const { clause, key } = filterJql(sp);
    const sort = SORTS[sp.get('sort') || ''] || SORTS.updated;
    const limit = Math.min(Math.max(parseInt(sp.get('limit') || '100', 10) || 100, 1), 200);
    const jql = `project in (${JIRA_PROJECTS.join(',')})${clause}`;
    const out = await cached(`search:${key}:${sort}:${limit}`, 120000, sp.get('fresh') === '1', async () => {
      const [total, issues] = await Promise.all([jiraCount(jql), jiraSearch(`${jql} ORDER BY ${sort}`, limit)]);
      return { configured: true, total, shown: issues.length, issues };
    });
    return NextResponse.json(out, { headers: { 'Cache-Control': 'private, max-age=120' } });
  } catch (e) {
    return NextResponse.json({ configured: true, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
