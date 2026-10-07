import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest, jiraConfigured, jiraSearch, JIRA_PROJECTS } from '@/lib/jira';

export const dynamic = 'force-dynamic';

const count = (items: string[]) =>
  Object.entries(items.reduce<Record<string, number>>((a, k) => ((a[k] = (a[k] || 0) + 1), a), {}))
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

// GET /api/jira/stats?days=30  (admin session required)
// Aggregates issues in JIRA_PROJECT_KEYS that were updated in the last N days (max 500 issues).
export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Admin login required' }, { status: 401 });
  if (!jiraConfigured()) return NextResponse.json({ configured: false });
  if (!JIRA_PROJECTS.length) {
    return NextResponse.json({ configured: true, error: 'Set JIRA_PROJECT_KEYS (e.g. CORE,EMR) to enable metrics' }, { status: 400 });
  }
  try {
    const days = Math.min(Math.max(parseInt(new URL(request.url).searchParams.get('days') || '30', 10) || 30, 1), 90);
    const issues = await jiraSearch(`project in (${JIRA_PROJECTS.join(',')}) AND updated >= -${days}d ORDER BY updated DESC`, 500);
    const now = Date.now();
    const within = (iso: string | null, d: number) => !!iso && now - new Date(iso).getTime() <= d * 86400000;
    const open = issues.filter((i) => i.statusCategory !== 'done');
    const bugs = open.filter((i) => /bug|defect/i.test(i.type));
    return NextResponse.json({
      configured: true,
      projects: JIRA_PROJECTS,
      windowDays: days,
      sampled: issues.length,
      truncated: issues.length >= 500,
      totals: {
        open: open.length,
        inProgress: issues.filter((i) => i.statusCategory === 'indeterminate').length,
        done: issues.filter((i) => i.statusCategory === 'done').length,
        openBugs: bugs.length,
        createdLast7d: issues.filter((i) => within(i.created, 7)).length,
        resolvedLast7d: issues.filter((i) => within(i.resolved, 7)).length,
        createdInWindow: issues.filter((i) => within(i.created, days)).length,
        resolvedInWindow: issues.filter((i) => within(i.resolved, days)).length,
      },
      byStatus: count(issues.map((i) => i.status)),
      byAssignee: count(open.map((i) => i.assignee || 'Unassigned')),
      byType: count(issues.map((i) => i.type)),
      openBugs: bugs.slice(0, 15),
    }, { headers: { 'Cache-Control': 'private, max-age=300' } });
  } catch (e) {
    return NextResponse.json({ configured: true, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
