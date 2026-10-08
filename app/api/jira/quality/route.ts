import { NextRequest, NextResponse } from 'next/server';
import { cached, canReadJira, jiraConfigured, JIRA_PROJECTS } from '@/lib/jira';
import { completeChangelogs, fetchIssuesWithChangelogPaged } from '@/lib/jira-activity';
import { computeQuality } from '@/lib/jira-quality';
import type { QualityResponse } from '@/lib/tickets-types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CAP = 800;

// GET /api/jira/quality?days=60  (admin session required). Read-only Jira calls.
export async function GET(request: NextRequest) {
  if (!canReadJira(request)) return NextResponse.json({ error: 'Admin login required' }, { status: 401 });
  const sp = new URL(request.url).searchParams;
  const days = Math.min(Math.max(parseInt(sp.get('days') || '60', 10) || 60, 14), 90);
  const now = Date.now();
  const empty: QualityResponse = {
    generatedAt: new Date(now).toISOString(), configured: jiraConfigured(), days, truncated: false, previousComplete: true, jiraError: null,
    ...computeQuality([], days, now),
  };
  if (!jiraConfigured()) return NextResponse.json({ ...empty, configured: false });
  if (!JIRA_PROJECTS.length) return NextResponse.json({ ...empty, jiraError: 'Set JIRA_PROJECT_KEYS' });

  const fresh = sp.get('fresh') === '1';
  try {
    const payload = await cached<QualityResponse>(`quality:${days}`, 120000, fresh, async () => {
      const proj = `project in (${JIRA_PROJECTS.join(',')})`;
      const t = Date.now();
      // Errors propagate (no inner catch) so `cached` never memoises an error payload; the outer catch reports them.
      // Bugs updated in the last 2*days (current + previous window), fetched once with their changelog.
      const res = await fetchIssuesWithChangelogPaged(
        `${proj} AND type = Bug AND updated >= -${2 * days}d ORDER BY updated DESC`, CAP,
        { fields: ['issuetype', 'status', 'created', 'resolutiondate', 'updated', 'summary', 'priority', 'assignee'] },
      );
      const unknown = await completeChangelogs(res.issues, undefined, { all: true });
      // Never guess from a cut-off history: drop issues whose changelog could not be completed.
      const usable = res.issues.filter((i) => {
        if (unknown.has(i.key)) return false;
        const total = Number(i.changelog?.total) || 0;
        return total <= (i.changelog?.histories?.length || 0);
      });
      // Fetching exactly CAP issues may mean more exist, so treat it as truncated too.
      const capped = res.truncated || res.issues.length >= CAP;
      const truncated = capped || unknown.size > 0 || usable.length < res.issues.length;
      // ORDER BY updated DESC: a capped fetch drops the oldest-updated bugs first, i.e. previous-window ones. If the oldest
      // fetched `updated` is still newer than the previous window start, the previous window is incomplete.
      const prevStart = t - 2 * days * 86400000;
      const updatedMs = res.issues.map((i) => Date.parse(i.fields?.updated || '')).filter(Number.isFinite);
      const oldest = updatedMs.length ? Math.min(...updatedMs) : Infinity;
      const previousComplete = !(capped && oldest > prevStart);
      return { generatedAt: new Date(t).toISOString(), configured: true, days, truncated, previousComplete, jiraError: null, ...computeQuality(usable, days, t, previousComplete) };
    });
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, max-age=120' } });
  } catch (e) {
    // Jira failure: 200 with jiraError; not cached.
    return NextResponse.json({ ...empty, configured: true, jiraError: e instanceof Error ? e.message : String(e) });
  }
}
