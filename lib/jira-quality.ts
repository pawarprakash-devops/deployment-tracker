/* eslint-disable @typescript-eslint/no-explicit-any -- raw Jira issue JSON */
// Pure (no network) calculations behind GET /api/jira/quality: bug time-to-resolve and reopened bugs.
// "Resolved" = reached QA Passed or any later stage (isResolvedStatus in lib/jira-activity.ts). A reopen is a
// transition from a resolved status back to a non-resolved one. Inputs are raw Jira issues carrying a COMPLETE
// changelog (the route excludes issues whose history is cut off).
//
// Worked examples (UTC):
//  1. Resolved twice: created Mon 09:00; In Dev -> QA Passed Tue 09:00 (first resolution); QA Passed -> In Dev Wed;
//     In Dev -> Done Fri 09:00. firstResolvedAt = Tue 09:00, so TTR = 24 h (the later Fri resolution is ignored);
//     one reopen event (Wed). Counted once in `ttr`, in the week of Tuesday.
//  2. Reopened then resolved again: same bug as above. TTR still uses the FIRST resolution (24 h); `reopened.events`
//     = 1, `reopened.bugs` = 1 when Wed is in the window; `recent` row has times = 1, from = QA Passed, to = In Dev.
//  3. Created already resolved: created in "Done" with no status transition (or first transition leaves a resolved
//     status: Done -> In Dev). No transition INTO a resolved stage from a non-resolved one => firstResolvedAt = null
//     => excluded from TTR (never guessed from `created`). In case Done -> In Dev it still yields a reopen event.
//  4. Reopened in window, first resolved before the window: counts in `reopened.bugs` and `events`, NOT in `ttr`
//     (its first resolution is outside the window); the rate denominator is only bugs resolved in the window.
//  5. Move between two resolved stages (QA Passed -> Released to Prod): neither a resolution nor a reopen.
//
// Hand-checked cases (no test runner available; each re-read against the code below):
//  A. No changelog / empty histories => statusTransitions [] => firstResolvedAt null, reopenEvents [].
//  B. Histories out of order (API returns newest first) are sorted ascending by `created` before use.
//  C. Item with field 'status' but `toString` inherited from Object.prototype (a function) => treated as ''
//     (typeof check), so it is neither resolved nor counted.
//  D. Resolution before `created` (data glitch) => negative hours => ignored (not counted anywhere in ttr).
//  E. Zero bugs in the window => count 0, medians/means/p90 null, rate null, all weeks present with zeros.
//
// Rate (COHORT): reopened.rate = among bugs first resolved in the window, the share reopened at any time after that
// first resolution (up to now). Numerator is a subset of the denominator by construction, so rate <= 1; null when nothing
// was resolved in the window. `reopened.bugs`/`events` still count every reopen in the window (case 4 included).
// Rejected outcomes (Won't fix, Duplicate, ...) are excluded from TTR and the cohort: see REJECTED_RE.

import { isResolvedStatus, priorityRank } from './jira-activity';
import { jiraBrowseUrl } from './jira';
import type { ReopenRow, ReopenSummary, ReopenWeek, SlowBug, TtrPriorityRow, TtrSummary, TtrWeek } from './tickets-types';

const DAY = 86400000;
const HOUR = 3600000;

export interface StatusTransition { at: string; from: string; to: string; by: string | null }

export function statusTransitions(issue: any): StatusTransition[] {
  const histories: any[] = Array.isArray(issue?.changelog?.histories) ? [...issue.changelog.histories] : [];
  histories.sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime());
  const out: StatusTransition[] = [];
  for (const h of histories) {
    for (const it of h.items || []) {
      if (it?.field !== 'status') continue;
      out.push({
        at: h.created,
        from: typeof it.fromString === 'string' ? it.fromString : '',
        to: typeof it.toString === 'string' ? it.toString : '',
        by: h.author?.displayName ?? null,
      });
    }
  }
  return out;
}

// ISO time of the FIRST transition into a resolved stage from a non-resolved one; null when there is none.
export function firstResolvedAt(issue: any): string | null {
  return firstResolvedTransition(issue)?.at ?? null;
}

// The FIRST transition into a resolved stage from a non-resolved one (carries the status it entered).
export function firstResolvedTransition(issue: any): StatusTransition | null {
  for (const t of statusTransitions(issue)) if (isResolvedStatus(t.to) && !isResolvedStatus(t.from)) return t;
  return null;
}

// stageOf maps rejection-style statuses to Done, but a bug closed as "Won't fix" / "Duplicate" was not really fixed
// quickly: bugs whose first resolved status matches this are excluded from time-to-resolve (and the reopen cohort).
const REJECTED_RE = /won'?t|not reproducible|duplicate|cancel|invalid|rejected/i;

// Transitions from a resolved status to a non-resolved one.
export function reopenEvents(issue: any): StatusTransition[] {
  // A transition with a missing `to` ('') is not a real move back; ignore it.
  return statusTransitions(issue).filter((t) => t.to !== '' && isResolvedStatus(t.from) && !isResolvedStatus(t.to));
}

const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const a = sorted(xs);
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
}
export function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
}
// Nearest-rank percentile.
export function p90(xs: number[]): number | null {
  if (!xs.length) return null;
  const a = sorted(xs);
  return a[Math.min(a.length - 1, Math.max(0, Math.ceil(0.9 * a.length) - 1))];
}
const r1 = (x: number | null): number | null => (x === null ? null : Math.round(x * 10) / 10);

// Monday (UTC, YYYY-MM-DD) of the ISO week containing ms.
export function weekStart(ms: number): string {
  const d = new Date(ms);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow)).toISOString().slice(0, 10);
}
function windowWeeks(days: number, now: number): string[] {
  const weeks: string[] = [];
  for (let t = Date.parse(weekStart(now - days * DAY)); t <= now; t += 7 * DAY) weeks.push(new Date(t).toISOString().slice(0, 10));
  return weeks;
}

export const TTR_BUCKETS = ['< 1 d', '1-3 d', '3-7 d', '7-14 d', '14 d+'] as const;
function bucketOf(hours: number): (typeof TTR_BUCKETS)[number] {
  if (hours < 24) return '< 1 d';
  if (hours < 72) return '1-3 d';
  if (hours < 168) return '3-7 d';
  if (hours < 336) return '7-14 d';
  return '14 d+';
}

interface Resolved { key: string; summary: string; priority: string | null; createdAt: string; resolvedAt: string; resolvedMs: number; hours: number; reopenCountAfterFirstResolve: number }

// `previousComplete` = false (the fetch did not reach back to the previous window) nulls both `previous` summaries.
export function computeQuality(issues: any[], days: number, now: number, previousComplete = true): { ttr: TtrSummary; reopened: ReopenSummary } {
  const curStart = now - days * DAY;
  const prevStart = now - 2 * days * DAY;
  const inCur = (ms: number) => ms >= curStart && ms <= now;
  const inPrev = (ms: number) => ms >= prevStart && ms < curStart;
  const weeks = windowWeeks(days, now);

  const resolved: Resolved[] = [];
  const reopenByBug: { key: string; summary: string; priority: string | null; assignee: string | null; events: StatusTransition[]; prevEvents: number }[] = [];

  for (const issue of issues) {
    const f = issue?.fields || {};
    const priority: string | null = f.priority?.name ?? null;
    const summary: string = f.summary || '';
    const rTr = firstResolvedTransition(issue);
    const rAt = rTr?.at ?? null;
    const createdMs = Date.parse(f.created || '');
    const ev = reopenEvents(issue);
    if (rTr && rAt && Number.isFinite(createdMs) && !REJECTED_RE.test(rTr.to)) {
      const rMs = Date.parse(rAt);
      const hours = (rMs - createdMs) / HOUR;
      const after = ev.filter((e) => Date.parse(e.at) > rMs).length;
      if (Number.isFinite(hours) && hours >= 0) resolved.push({ key: issue.key, summary, priority, createdAt: f.created, resolvedAt: rAt, resolvedMs: rMs, hours, reopenCountAfterFirstResolve: after });
    }
    const cur = ev.filter((e) => inCur(Date.parse(e.at)));
    const prevCount = ev.filter((e) => inPrev(Date.parse(e.at))).length;
    if (cur.length || prevCount) reopenByBug.push({ key: issue.key, summary, priority, assignee: f.assignee?.displayName ?? null, events: cur, prevEvents: prevCount });
  }

  const curRes = resolved.filter((r) => inCur(r.resolvedMs));
  const prevRes = resolved.filter((r) => inPrev(r.resolvedMs));
  const hoursOf = (rs: Resolved[]) => rs.map((r) => r.hours);

  const byWeek: TtrWeek[] = weeks.map((week) => {
    const hs = hoursOf(curRes.filter((r) => weekStart(r.resolvedMs) === week));
    return { week, resolved: hs.length, medianHours: r1(median(hs)), meanHours: r1(mean(hs)) };
  });

  const prio = new Map<string, number[]>();
  for (const r of curRes) {
    const p = r.priority || '(none)';
    prio.set(p, [...(prio.get(p) || []), r.hours]);
  }
  const byPriority: TtrPriorityRow[] = [...prio]
    .map(([priority, hs]) => ({ priority, count: hs.length, medianHours: r1(median(hs)), meanHours: r1(mean(hs)) }))
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.priority.localeCompare(b.priority));

  const distribution = TTR_BUCKETS.map((bucket) => ({ bucket: bucket as string, count: curRes.filter((r) => bucketOf(r.hours) === bucket).length }));

  const slowest: SlowBug[] = [...curRes].sort((a, b) => b.hours - a.hours).slice(0, 10).map((r) => ({
    key: r.key, summary: r.summary, priority: r.priority, hours: r1(r.hours) ?? 0, createdAt: r.createdAt, resolvedAt: r.resolvedAt, url: jiraBrowseUrl(r.key),
  }));

  const ttr: TtrSummary = {
    count: curRes.length,
    medianHours: r1(median(hoursOf(curRes))),
    meanHours: r1(mean(hoursOf(curRes))),
    p90Hours: r1(p90(hoursOf(curRes))),
    previous: previousComplete ? { count: prevRes.length, medianHours: r1(median(hoursOf(prevRes))), meanHours: r1(mean(hoursOf(prevRes))) } : null,
    byWeek, byPriority, distribution, slowest,
  };

  // ---- reopened ----
  const reopenedBugs = reopenByBug.filter((b) => b.events.length > 0);
  const events = reopenedBugs.reduce((s, b) => s + b.events.length, 0);
  const cohortReopened = (rs: Resolved[]) => rs.filter((r) => r.reopenCountAfterFirstResolve > 0).length;
  const rate = (n: number, d: number) => (d === 0 ? null : Math.min(1, Math.max(0, n / d)));

  const weekMap = new Map<string, ReopenWeek>(weeks.map((w) => [w, { week: w, reopened: 0, resolved: 0 }]));
  for (const r of curRes) { const w = weekMap.get(weekStart(r.resolvedMs)); if (w) w.resolved++; }
  for (const b of reopenedBugs) for (const e of b.events) { const w = weekMap.get(weekStart(Date.parse(e.at))); if (w) w.reopened++; }

  const rp = new Map<string, number>();
  for (const b of reopenedBugs) rp.set(b.priority || '(none)', (rp.get(b.priority || '(none)') || 0) + 1);

  const recent: ReopenRow[] = reopenedBugs
    .map((b) => {
      const last = b.events[b.events.length - 1]; // events are chronological
      return { key: b.key, summary: b.summary, priority: b.priority, assignee: b.assignee, times: b.events.length, lastReopenedAt: last.at, from: last.from, to: last.to, by: last.by, url: jiraBrowseUrl(b.key) };
    })
    .sort((a, b) => Date.parse(b.lastReopenedAt) - Date.parse(a.lastReopenedAt))
    .slice(0, 25);

  const prevBugs = reopenByBug.filter((b) => b.prevEvents > 0);
  const prevEvents = prevBugs.reduce((s, b) => s + b.prevEvents, 0);

  const reopened: ReopenSummary = {
    events,
    bugs: reopenedBugs.length,
    rate: rate(cohortReopened(curRes), curRes.length),
    cohort: { resolved: curRes.length, reopened: cohortReopened(curRes) },
    previous: previousComplete ? { events: prevEvents, bugs: prevBugs.length, rate: rate(cohortReopened(prevRes), prevRes.length) } : null,
    byWeek: [...weekMap.values()],
    byPriority: [...rp].map(([priority, bugs]) => ({ priority, bugs })).sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.priority.localeCompare(b.priority)),
    recent,
  };
  return { ttr, reopened };
}
