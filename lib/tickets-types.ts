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
