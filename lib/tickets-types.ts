// Client-safe response types for the Tickets page endpoints (no server imports here).
// GET /api/jira/bugs and GET /api/jira/activity (admin only, same auth as the other /api/jira routes).

export interface DayPoint {
  date: string; // YYYY-MM-DD, UTC
  created: number;
  resolved: number;
}

export interface BugRow {
  key: string;
  summary: string;
  status: string;
  stage: string; // stageOf(status) from lib/jira.ts
  priority: string | null;
  assignee: string | null;
  reporter: string | null;
  created: string; // ISO
  updated: string; // ISO
  resolved: string | null; // when it reached QA Passed or any later stage (not Jira's resolution date); null while open
  ageDays: number; // whole days since created (or until resolved)
  labels: string[];
  components: string[];
  url: string;
}

export interface BugsResponse {
  generatedAt: string;
  configured: boolean;
  days: number; // window used for the series and recent list
  recent: BugRow[]; // bugs created in the window, newest first (max 50)
  bugSeries: DayPoint[]; // exactly `days` entries, oldest first, zero-filled
  issueSeries: DayPoint[]; // same for all issue types
  raised: number; // bugs created in the window
  resolved: number; // bugs that reached QA Passed or any later stage in the window (not Jira's resolution date)
  open: { total: number; byPriority: { priority: string; count: number }[]; byAge: { bucket: string; count: number }[] };
  truncated: boolean; // a cap was hit (issue fetch, bug list, or unresolvable changelog): numbers may be understated
  jiraError: string | null;
}

export type ActivityKind = 'created' | 'status' | 'assignee' | 'priority' | 'comment' | 'resolved' | 'deploy' | 'other';

export interface ActivityEvent {
  id: string; // unique and stable (e.g. changelog history id + item index, comment id, deployment id)
  at: string; // ISO
  kind: ActivityKind;
  key: string; // Jira key the event belongs to
  title: string; // issue summary when known, else ''
  issueType: string | null;
  priority: string | null;
  actor: string | null; // person, or deployer for deploys
  from: string | null; // status/assignee/priority before
  to: string | null; // status/assignee/priority after
  text: string | null; // comment excerpt (plain text, max 240 chars)
  env: string | null; // deploy events: environment name
  url: string | null; // Jira browse URL (or the deployment run URL for deploys)
}

export interface ActivityResponse {
  generatedAt: string;
  configured: boolean;
  days: number;
  events: ActivityEvent[]; // newest first (max 300)
  counts: Record<ActivityKind, number>;
  truncated: boolean;
  jiraError: string | null;
}

// ---- GET /api/jira/quality: time to resolve and reopened bugs --------------------------------------
// "Resolved" = reached QA Passed or any later stage (see lib/jira-activity.ts). All weeks are UTC ISO weeks,
// identified by their Monday (YYYY-MM-DD). Hours are wall-clock hours.

export interface TtrWeek {
  week: string; // Monday of the week
  resolved: number; // bugs whose FIRST entry into a resolved stage fell in this week
  medianHours: number | null; // null when resolved === 0
  meanHours: number | null;
}

export interface TtrPriorityRow {
  priority: string; // '(none)' when unset
  count: number;
  medianHours: number | null;
  meanHours: number | null;
}

export interface SlowBug {
  key: string;
  summary: string;
  priority: string | null;
  hours: number; // created -> first resolved
  createdAt: string;
  resolvedAt: string; // first entry into a resolved stage
  url: string;
}

export interface TtrSummary {
  count: number; // bugs first resolved in the window (created-already-resolved bugs are excluded)
  medianHours: number | null;
  meanHours: number | null;
  p90Hours: number | null;
  previous: { count: number; medianHours: number | null; meanHours: number | null } | null; // same-length window before
  byWeek: TtrWeek[]; // oldest first, zero-filled for every week in the window
  byPriority: TtrPriorityRow[]; // Highest..Lowest then others
  distribution: { bucket: string; count: number }[]; // '< 1 d', '1-3 d', '3-7 d', '7-14 d', '14 d+'
  slowest: SlowBug[]; // top 10 by hours
}

export interface ReopenWeek {
  week: string;
  reopened: number; // reopen EVENTS that week (resolved stage -> earlier stage)
  resolved: number; // bugs first resolved that week (context for the rate)
}

export interface ReopenRow {
  key: string;
  summary: string;
  priority: string | null;
  assignee: string | null;
  times: number; // reopen events for this bug in the window
  lastReopenedAt: string;
  from: string; // status it left (resolved)
  to: string; // status it moved back to
  by: string | null; // who moved it back (changelog author)
  url: string;
}

export interface ReopenSummary {
  events: number; // reopen events in the window
  bugs: number; // distinct bugs reopened in the window
  // COHORT rate: among bugs first resolved in the window, the share reopened at any time after that first resolution
  // (cohort.reopened / cohort.resolved, 0..1); null when nothing was resolved. `bugs`/`events` count ALL reopens in the window.
  rate: number | null;
  cohort?: { resolved: number; reopened: number }; // numerator/denominator of `rate` for the current window
  previous: { events: number; bugs: number; rate: number | null } | null; // null when previousComplete is false
  byWeek: ReopenWeek[]; // oldest first, zero-filled
  byPriority: { priority: string; bugs: number }[];
  recent: ReopenRow[]; // newest reopen first, max 25
}

export interface QualityResponse {
  generatedAt: string;
  configured: boolean;
  days: number; // window (clamped 14-90)
  truncated: boolean; // a safety cap cut the data (or the fetch hit it exactly): numbers may be incomplete
  // false when the cap dropped bugs that could belong to the previous window; ttr.previous / reopened.previous are then null.
  previousComplete: boolean;
  jiraError: string | null;
  ttr: TtrSummary;
  reopened: ReopenSummary;
}
