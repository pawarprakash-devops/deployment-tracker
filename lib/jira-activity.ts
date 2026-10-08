/* eslint-disable @typescript-eslint/no-explicit-any */
// Helpers for /api/jira/bugs and /api/jira/activity (server-only; read-only against Jira).
import { jiraFetch, jiraBrowseUrl, stageOf } from './jira';
import type { ActivityEvent, ActivityKind, DayPoint } from './tickets-types';

const DAY = 86400000;
const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);

// ---- Pure helpers ------------------------------------------------------------------------------

// Atlassian Document Format -> plain text (recursively concatenates `text` nodes), whitespace collapsed.
export function adfToText(node: unknown, max = 240): string {
  const parts: string[] = [];
  const walk = (n: any) => {
    if (n == null) return;
    if (typeof n === 'string') { parts.push(n); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (typeof n !== 'object') return;
    if (typeof n.text === 'string') parts.push(n.text);
    else if (n.type === 'mention' && n.attrs?.text) parts.push(String(n.attrs.text));
    else if (n.type === 'hardBreak') parts.push(' ');
    if (n.content) walk(n.content);
    if (n.type === 'paragraph' || n.type === 'heading' || n.type === 'listItem') parts.push(' ');
  };
  walk(node);
  const s = parts.join('').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

// Exactly `days` UTC-day buckets ending today (oldest first), zero-filled.
export function bucketByDay(items: Array<{ created?: string | null; resolved?: string | null }>, days: number, now = Date.now()): DayPoint[] {
  const points: DayPoint[] = [];
  const index = new Map<string, DayPoint>();
  for (let k = days - 1; k >= 0; k--) {
    const p: DayPoint = { date: utcDay(now - k * DAY), created: 0, resolved: 0 };
    points.push(p);
    index.set(p.date, p);
  }
  for (const i of items) {
    if (i.created) { const p = index.get(utcDay(new Date(i.created).getTime())); if (p) p.created++; }
    if (i.resolved) { const p = index.get(utcDay(new Date(i.resolved).getTime())); if (p) p.resolved++; }
  }
  return points;
}

// ---- "Resolved" for the dashboard: QA Passed counts as resolved --------------------------------
// A ticket is resolved once it has passed QA, i.e. it is in QA Passed or any later stage (this team does not
// always set Jira's own resolution). Reopening it (moving back before QA Passed) makes it open again.
export const RESOLVED_STAGES = new Set<string>(['QA Passed', 'Stage / Pre-Prod', 'Released to Prod', 'Done']);
export const isResolvedStatus = (statusName: string, category?: string): boolean => RESOLVED_STAGES.has(stageOf(statusName, category));

// ISO time the issue most recently entered a resolved stage and is still in one; null when it is not resolved now or the
// date cannot be determined. Order: (1) the changelog transition; (2) Jira's resolutiondate; (3) `created` when the issue
// was created directly in a resolved stage (complete changelog without any status history, or whose first status change
// already leaves a resolved status). `updated` / `statuscategorychangedate` are never used: they date other events.
// Callers must pass a COMPLETE changelog (see completeChangelogs); an incomplete one yields wrong dates.
export function resolvedAtFromIssue(issue: any): string | null {
  const f = issue?.fields || {};
  if (!isResolvedStatus(f.status?.name || '', f.status?.statusCategory?.key)) return null;
  const hasChangelog = Array.isArray(issue?.changelog?.histories);
  const histories: any[] = [...(issue?.changelog?.histories || [])].sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime());
  let at: string | null = null;
  let seenStatus = false;
  for (const h of histories) {
    for (const it of h.items || []) {
      if (it.field !== 'status') continue;
      const to = isResolvedStatus(typeof it.toString === 'string' ? it.toString : '');
      const from = isResolvedStatus(typeof it.fromString === 'string' ? it.fromString : '');
      if (!seenStatus && from) at = f.created ?? null; // first move starts from a resolved status: created resolved
      seenStatus = true;
      if (to && !from) at = h.created;
      else if (!to && from) at = null;
    }
  }
  if (at) return at;
  if (f.resolutiondate) return f.resolutiondate;
  if (hasChangelog && !seenStatus) return f.created ?? null; // created directly in a resolved status
  return null;
}

const CHANGELOG_PAGE = 100; // Jira's search `expand=changelog` returns at most this many histories per issue
export const FULL_HISTORY_CAP = 30;

// Fetch complete histories (GET /issue/{key}/changelog, paginated) for resolved-stage issues whose embedded changelog may
// be cut off, replacing `issue.changelog.histories` in place. Returns the keys that could not be completed (beyond the cap
// or failed): their resolution date is unknown, so callers must exclude them rather than guess.
export async function completeChangelogs(issues: any[], cap = FULL_HISTORY_CAP): Promise<Set<string>> {
  const unknown = new Set<string>();
  const need = issues.filter((i) => {
    if (!isResolvedStatus(i.fields?.status?.name || '', i.fields?.status?.statusCategory?.key)) return false;
    const n = Math.max(Number(i.changelog?.total) || 0, i.changelog?.histories?.length || 0);
    return n >= CHANGELOG_PAGE;
  });
  for (const i of need.slice(cap)) unknown.add(i.key);
  const work = need.slice(0, cap);
  for (let c = 0; c < work.length; c += 5) {
    await Promise.all(work.slice(c, c + 5).map(async (issue) => {
      try {
        const all: any[] = [];
        let startAt = 0;
        for (let page = 0; page < 50; page++) {
          const data = await jiraFetch(`/rest/api/3/issue/${encodeURIComponent(issue.key)}/changelog?startAt=${startAt}&maxResults=${CHANGELOG_PAGE}`);
          const values: any[] = data.values || [];
          all.push(...values);
          startAt += values.length;
          if (data.isLast || !values.length || (typeof data.total === 'number' && startAt >= data.total)) break;
        }
        issue.changelog = { ...(issue.changelog || {}), histories: all, total: Math.max(all.length, Number(issue.changelog?.total) || 0) };
      } catch {
        unknown.add(issue.key);
      }
    }));
  }
  return unknown;
}

export const AGE_BUCKETS = ['0-2 d', '3-7 d', '8-14 d', '15-30 d', '30+ d'] as const;
export function ageBucket(ageDays: number): (typeof AGE_BUCKETS)[number] {
  if (ageDays <= 2) return '0-2 d';
  if (ageDays <= 7) return '3-7 d';
  if (ageDays <= 14) return '8-14 d';
  if (ageDays <= 30) return '15-30 d';
  return '30+ d';
}

const PRIORITY_ORDER = ['Highest', 'High', 'Medium', 'Low', 'Lowest'];
export function priorityRank(p: string): number {
  const i = PRIORITY_ORDER.indexOf(p);
  return i === -1 ? PRIORITY_ORDER.length : i;
}

export const ACTIVITY_KINDS: ActivityKind[] = ['created', 'status', 'assignee', 'priority', 'comment', 'resolved', 'deploy', 'other'];
export const emptyCounts = (): Record<ActivityKind, number> =>
  Object.fromEntries(ACTIVITY_KINDS.map((k) => [k, 0])) as Record<ActivityKind, number>;

// ---- Jira fetch with changelog + comments --------------------------------------------------------

const ACTIVITY_FIELDS = ['summary', 'status', 'issuetype', 'priority', 'assignee', 'created', 'resolutiondate', 'reporter', 'comment'];

export interface ChangelogFetchOpts { fields?: string[] }

// Same as fetchIssuesWithChangelog but also reports whether the maxIssues cap cut the result short.
export async function fetchIssuesWithChangelogPaged(jql: string, maxIssues = 150, opts?: ChangelogFetchOpts): Promise<{ issues: any[]; truncated: boolean }> {
  const issues: any[] = [];
  let truncated = false;
  let nextPageToken: string | undefined;
  while (issues.length < maxIssues) {
    const data = await jiraFetch('/rest/api/3/search/jql', {
      method: 'POST',
      body: { jql, fields: opts?.fields || ACTIVITY_FIELDS, expand: 'changelog', maxResults: Math.min(100, maxIssues - issues.length), nextPageToken },
    });
    issues.push(...(data.issues || []));
    if (data.isLast || !data.nextPageToken) break;
    nextPageToken = data.nextPageToken;
    if (issues.length >= maxIssues) truncated = true;
  }
  return { issues, truncated };
}

export async function fetchIssuesWithChangelog(jql: string, maxIssues = 150, opts?: ChangelogFetchOpts): Promise<any[]> {
  return (await fetchIssuesWithChangelogPaged(jql, maxIssues, opts)).issues;
}

export interface IssueMeta { title: string; issueType: string | null; priority: string | null }

// Turn raw Jira issues (with changelog) into activity events inside [sinceMs, now].
export function eventsFromIssues(issues: any[], sinceMs: number): { events: ActivityEvent[]; meta: Map<string, IssueMeta> } {
  const events: ActivityEvent[] = [];
  const meta = new Map<string, IssueMeta>();
  const inWindow = (s?: string | null) => { if (!s) return false; const t = new Date(s).getTime(); return Number.isFinite(t) && t >= sinceMs; };

  for (const issue of issues) {
    const f = issue.fields || {};
    const key: string = issue.key;
    const base = { key, title: f.summary || '', issueType: f.issuetype?.name || null, priority: f.priority?.name || null, env: null, text: null, from: null, to: null };
    const url = jiraBrowseUrl(key);
    meta.set(key, { title: base.title, issueType: base.issueType, priority: base.priority });

    if (inWindow(f.created)) {
      events.push({ ...base, id: `${key}:created`, at: new Date(f.created).toISOString(), kind: 'created', actor: f.reporter?.displayName || null, url });
    }
    const resolvedInWindow = inWindow(f.resolutiondate);
    if (resolvedInWindow) {
      events.push({ ...base, id: `${key}:resolved`, at: new Date(f.resolutiondate).toISOString(), kind: 'resolved', actor: f.assignee?.displayName || null, to: f.status?.name || null, url });
    }

    for (const h of issue.changelog?.histories || []) {
      if (!inWindow(h.created)) continue;
      const actor = h.author?.displayName || null;
      const at = new Date(h.created).toISOString();
      (h.items || []).forEach((it: any, idx: number) => {
        const field = String(it.field || '');
        const lower = field.toLowerCase();
        let kind: ActivityKind | null = null;
        if (lower === 'status' || lower === 'assignee' || lower === 'priority') kind = lower as ActivityKind;
        else if (lower === 'resolution') kind = resolvedInWindow ? null : 'other'; // the 'resolved' event already covers it
        else if (lower === 'labels' || lower === 'fix version') kind = 'other';
        if (!kind) return;
        const from = it.fromString ?? null, to = it.toString ?? null;
        events.push({
          ...base, id: `${key}:h${h.id}:${idx}`, at, kind, actor,
          from: kind === 'other' ? (from ? `${field}: ${from}` : field) : from,
          to: kind === 'other' ? (to ? `${field}: ${to}` : `${field} cleared`) : to,
          url,
        });
      });
    }

    for (const c of f.comment?.comments || []) {
      if (!inWindow(c.created)) continue;
      events.push({
        ...base, id: `${key}:c${c.id}`, at: new Date(c.created).toISOString(), kind: 'comment',
        actor: c.author?.displayName || null, text: adfToText(c.body) || null, url,
      });
    }
  }
  return { events, meta };
}
