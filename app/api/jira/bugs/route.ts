import { NextRequest, NextResponse } from 'next/server';
import { cached, canReadJira, jiraConfigured, jiraCount, jiraSearch, stageOf, JIRA_PROJECTS, type JiraIssue } from '@/lib/jira';
import { ageBucket, AGE_BUCKETS, bucketByDay, completeChangelogs, fetchIssuesWithChangelogPaged, isResolvedStatus, priorityRank, resolvedAtFromIssue } from '@/lib/jira-activity';
import type { BugRow, BugsResponse } from '@/lib/tickets-types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DAY = 86400000;

// `resolvedAt`: when the bug reached QA Passed or later (null while it is still open).
function toRow(i: JiraIssue, now: number, resolvedAt: string | null): BugRow {
  const end = resolvedAt ? new Date(resolvedAt).getTime() : now;
  return {
    key: i.key, summary: i.summary, status: i.status, stage: stageOf(i.status, i.statusCategory), priority: i.priority,
    assignee: i.assignee, reporter: i.reporter, created: i.created, updated: i.updated, resolved: resolvedAt,
    ageDays: Math.max(0, Math.floor((end - new Date(i.created).getTime()) / DAY)),
    labels: i.labels, components: i.components, url: i.url,
  };
}

// GET /api/jira/bugs?days=30  (admin session required)
export async function GET(request: NextRequest) {
  if (!canReadJira(request)) return NextResponse.json({ error: 'Admin login required' }, { status: 401 });
  const sp = new URL(request.url).searchParams;
  const days = Math.min(Math.max(parseInt(sp.get('days') || '30', 10) || 30, 7), 90);
  const now = Date.now();
  const empty: BugsResponse = {
    generatedAt: new Date(now).toISOString(), configured: jiraConfigured(), days, recent: [],
    bugSeries: bucketByDay([], days, now), issueSeries: bucketByDay([], days, now), raised: 0, resolved: 0, truncated: false,
    open: { total: 0, byPriority: [], byAge: AGE_BUCKETS.map((bucket) => ({ bucket, count: 0 })) }, jiraError: null,
  };
  if (!jiraConfigured()) return NextResponse.json({ ...empty, configured: false });
  if (!JIRA_PROJECTS.length) return NextResponse.json({ ...empty, jiraError: 'Set JIRA_PROJECT_KEYS' });

  const fresh = sp.get('fresh') === '1';
  try {
    const payload = await cached<BugsResponse>(`bugs:${days}`, 120000, fresh, async () => {
      const proj = `project in (${JIRA_PROJECTS.join(',')})`;
      const t = Date.now();
      // Errors propagate (no inner catch) so `cached` never memoises an error payload; the outer catch reports them.
      // "Resolved" = reached QA Passed or later (not Jira's resolution date). Everything updated in the window is
      // fetched once with its changelog (no comments: much cheaper); created/resolved are bucketed per day from that.
      const openJql = `${proj} AND type = Bug AND statusCategory != Done`;
      const [bugsCreated, openAll, openCount, changedRes] = await Promise.all([
        jiraSearch(`${proj} AND type = Bug AND created >= -${days}d ORDER BY created DESC`, 500),
        jiraSearch(`${openJql} ORDER BY created DESC`, 500),
        jiraCount(openJql).catch(() => null),
        fetchIssuesWithChangelogPaged(`${proj} AND updated >= -${days}d ORDER BY updated DESC`, 800, { fields: ['issuetype', 'status', 'created', 'resolutiondate', 'updated'] }),
      ]);
      const changed = changedRes.issues;
      // search returns <=100 histories per issue; fetch the full history for resolved-stage issues that may be cut off.
      const unknown = await completeChangelogs(changed);
      let truncated = changedRes.truncated || bugsCreated.length >= 500 || unknown.size > 0;

      const openList = openAll.filter((i) => !isResolvedStatus(i.status, i.statusCategory));
      const openListTruncated = openAll.length >= 500;
      // List complete: it is exact. Capped at 500: Jira's count minus the resolved-stage bugs seen in the list (an estimate).
      let openTotal = openList.length;
      if (openListTruncated) {
        truncated = true;
        if (openCount !== null) openTotal = Math.max(openList.length, openCount - (openAll.length - openList.length));
      }

      const resolvedAt = new Map<string, string>();
      const changedItems = changed.map((i) => {
        const r = unknown.has(i.key) ? null : resolvedAtFromIssue(i);
        if (r && i.fields?.issuetype?.name === 'Bug') resolvedAt.set(i.key, r);
        return { type: i.fields?.issuetype?.name as string | undefined, created: i.fields?.created as string | null | undefined, resolved: r };
      });
      const bugResolved = changedItems.filter((x) => x.type === 'Bug').map((x) => ({ resolved: x.resolved }));

      const byPrio = new Map<string, number>();
      const byAge = new Map<string, number>(AGE_BUCKETS.map((b) => [b, 0]));
      for (const i of openList) {
        const p = i.priority || '(none)';
        byPrio.set(p, (byPrio.get(p) || 0) + 1);
        const age = Math.max(0, Math.floor((t - new Date(i.created).getTime()) / DAY));
        byAge.set(ageBucket(age), (byAge.get(ageBucket(age)) || 0) + 1);
      }

      // `recent` rows: a bug in a resolved stage must not look open. Its date is the series date when known; when it is
      // unknown (excluded or undeterminable) the row DISPLAYS Jira's status-change time instead, but the series excludes it.
      const rowResolved = (i: JiraIssue) =>
        resolvedAt.get(i.key) ?? (isResolvedStatus(i.status, i.statusCategory) ? (i.statusChanged ?? i.resolved ?? i.created) : null);
      const bugSeries = bucketByDay([...bugsCreated.map((i) => ({ created: i.created })), ...bugResolved], days, t);
      return {
        generatedAt: new Date(t).toISOString(), configured: true, days,
        recent: bugsCreated.slice(0, 50).map((i) => toRow(i, t, rowResolved(i))),
        bugSeries,
        issueSeries: bucketByDay(changedItems.map((x) => ({ created: x.created, resolved: x.resolved })), days, t),
        raised: bugsCreated.length, resolved: bugSeries.reduce((a, d) => a + d.resolved, 0),
        open: {
          total: openTotal,
          byPriority: [...byPrio].map(([priority, count]) => ({ priority, count })).sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.priority.localeCompare(b.priority)),
          byAge: AGE_BUCKETS.map((bucket) => ({ bucket, count: byAge.get(bucket) || 0 })),
        },
        truncated,
        jiraError: null,
      };
    });
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, max-age=120' } });
  } catch (e) {
    // Jira failure: 200 with jiraError (as before for Jira errors); not cached.
    return NextResponse.json({ ...empty, configured: true, jiraError: e instanceof Error ? e.message : String(e) });
  }
}
