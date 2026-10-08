import { NextRequest, NextResponse } from 'next/server';
import { cached, isAdminRequest, jiraConfigured, jiraSearch, stageOf, JIRA_PROJECTS, type JiraIssue } from '@/lib/jira';
import { ageBucket, AGE_BUCKETS, bucketByDay, priorityRank } from '@/lib/jira-activity';
import type { BugRow, BugsResponse } from '@/lib/tickets-types';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const DAY = 86400000;

function toRow(i: JiraIssue, now: number): BugRow {
  const end = i.resolved ? new Date(i.resolved).getTime() : now;
  return {
    key: i.key, summary: i.summary, status: i.status, stage: stageOf(i.status, i.statusCategory), priority: i.priority,
    assignee: i.assignee, reporter: i.reporter, created: i.created, updated: i.updated, resolved: i.resolved,
    ageDays: Math.max(0, Math.floor((end - new Date(i.created).getTime()) / DAY)),
    labels: i.labels, components: i.components, url: i.url,
  };
}

// GET /api/jira/bugs?days=30  (admin session required)
export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Admin login required' }, { status: 401 });
  const sp = new URL(request.url).searchParams;
  const days = Math.min(Math.max(parseInt(sp.get('days') || '30', 10) || 30, 7), 90);
  const now = Date.now();
  const empty: BugsResponse = {
    generatedAt: new Date(now).toISOString(), configured: jiraConfigured(), days, recent: [],
    bugSeries: bucketByDay([], days, now), issueSeries: bucketByDay([], days, now), raised: 0, resolved: 0,
    open: { total: 0, byPriority: [], byAge: AGE_BUCKETS.map((bucket) => ({ bucket, count: 0 })) }, jiraError: null,
  };
  if (!jiraConfigured()) return NextResponse.json({ ...empty, configured: false });
  if (!JIRA_PROJECTS.length) return NextResponse.json({ ...empty, jiraError: 'Set JIRA_PROJECT_KEYS' });

  const fresh = sp.get('fresh') === '1';
  try {
    const payload = await cached<BugsResponse>(`bugs:${days}`, 120000, fresh, async () => {
      const proj = `project in (${JIRA_PROJECTS.join(',')})`;
      const t = Date.now();
      try {
        const [bugsCreated, bugsResolved, issuesCreated, issuesResolved, openBugs] = await Promise.all([
          jiraSearch(`${proj} AND type = Bug AND created >= -${days}d ORDER BY created DESC`, 500),
          jiraSearch(`${proj} AND type = Bug AND resolutiondate >= -${days}d ORDER BY resolutiondate DESC`, 500),
          jiraSearch(`${proj} AND created >= -${days}d ORDER BY created DESC`, 800),
          jiraSearch(`${proj} AND resolutiondate >= -${days}d ORDER BY resolutiondate DESC`, 800),
          jiraSearch(`${proj} AND type = Bug AND statusCategory != Done ORDER BY created DESC`, 500),
        ]);

        const byPrio = new Map<string, number>();
        const byAge = new Map<string, number>(AGE_BUCKETS.map((b) => [b, 0]));
        for (const i of openBugs) {
          const p = i.priority || '(none)';
          byPrio.set(p, (byPrio.get(p) || 0) + 1);
          const age = Math.max(0, Math.floor((t - new Date(i.created).getTime()) / DAY));
          byAge.set(ageBucket(age), (byAge.get(ageBucket(age)) || 0) + 1);
        }

        return {
          generatedAt: new Date(t).toISOString(), configured: true, days,
          recent: bugsCreated.slice(0, 50).map((i) => toRow(i, t)),
          // each series counts created by `created` and resolved by `resolved`, from the matching query's timestamps
          bugSeries: bucketByDay([...bugsCreated.map((i) => ({ created: i.created })), ...bugsResolved.map((i) => ({ resolved: i.resolved }))], days, t),
          issueSeries: bucketByDay([...issuesCreated.map((i) => ({ created: i.created })), ...issuesResolved.map((i) => ({ resolved: i.resolved }))], days, t),
          raised: bugsCreated.length, resolved: bugsResolved.length,
          open: {
            total: openBugs.length,
            byPriority: [...byPrio].map(([priority, count]) => ({ priority, count })).sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.priority.localeCompare(b.priority)),
            byAge: AGE_BUCKETS.map((bucket) => ({ bucket, count: byAge.get(bucket) || 0 })),
          },
          jiraError: null,
        };
      } catch (e) {
        return { ...empty, generatedAt: new Date(t).toISOString(), configured: true, jiraError: e instanceof Error ? e.message : String(e) };
      }
    });
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, max-age=120' } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
