/* eslint-disable @typescript-eslint/no-explicit-any */
// Helpers for /api/jira/bugs and /api/jira/activity (server-only; read-only against Jira).
import { jiraFetch, jiraBrowseUrl } from './jira';
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

export async function fetchIssuesWithChangelog(jql: string, maxIssues = 150): Promise<any[]> {
  const issues: any[] = [];
  let nextPageToken: string | undefined;
  while (issues.length < maxIssues) {
    const data = await jiraFetch('/rest/api/3/search/jql', {
      method: 'POST',
      body: { jql, fields: ACTIVITY_FIELDS, expand: 'changelog', maxResults: Math.min(100, maxIssues - issues.length), nextPageToken },
    });
    issues.push(...(data.issues || []));
    if (data.isLast || !data.nextPageToken) break;
    nextPageToken = data.nextPageToken;
  }
  return issues;
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
