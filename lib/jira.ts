// Jira Cloud integration. Credentials live only in server env vars:
//   JIRA_BASE_URL      e.g. https://vidaisolutions.atlassian.net
//   JIRA_EMAIL         Atlassian account email that owns the API token
//   JIRA_API_TOKEN     API token (https://id.atlassian.com/manage-profile/security/api-tokens)
//   JIRA_PROJECT_KEYS  optional, comma separated (e.g. CORE,EMR). Required for /api/jira/stats;
//                      when set it also restricts which keys are recognised in deployment text.

const BASE = (process.env.JIRA_BASE_URL || '').replace(/\/+$/, '');
const EMAIL = process.env.JIRA_EMAIL;
const TOKEN = process.env.JIRA_API_TOKEN;

export const JIRA_PROJECTS = (process.env.JIRA_PROJECT_KEYS || '')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter((s) => /^[A-Z][A-Z0-9]{1,9}$/.test(s));

export const jiraConfigured = () => Boolean(BASE && EMAIL && TOKEN);
export const jiraBrowseUrl = (key: string) => `${BASE}/browse/${key}`;

const KEY_RE = /\b([A-Z][A-Z0-9]{1,9})-(\d{1,6})\b/g;
// Things that look like Jira keys but are not (only used when JIRA_PROJECT_KEYS is unset).
const NOT_PROJECTS = new Set(['UTF', 'SHA', 'ISO', 'HTTP', 'AES', 'RSA', 'MD', 'TLS', 'SSL', 'PR', 'FE', 'BE', 'COVID', 'ECS', 'EC']);

export function extractJiraKeys(...texts: Array<string | null | undefined>): string[] {
  const out = new Set<string>();
  const text = texts.filter(Boolean).join(' ');
  for (const m of text.matchAll(KEY_RE)) {
    const proj = m[1];
    if (JIRA_PROJECTS.length ? !JIRA_PROJECTS.includes(proj) : NOT_PROJECTS.has(proj)) continue;
    out.add(`${proj}-${m[2]}`);
  }
  return [...out];
}

export const isValidKey = (k: string) => /^[A-Z][A-Z0-9]{1,9}-\d{1,6}$/.test(k);

export { isAdminRequest } from './auth';

export interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  statusCategory: 'new' | 'indeterminate' | 'done' | string;
  type: string;
  priority: string | null;
  assignee: string | null;
  created: string;
  resolved: string | null;
  reporter: string | null;
  labels: string[];
  components: string[];
  fixVersions: string[];
  updated: string;
  statusChanged: string | null; // when the status category last changed (Jira field statuscategorychangedate)
  url: string;
}

const FIELDS = ['summary', 'status', 'issuetype', 'priority', 'assignee', 'created', 'resolutiondate', 'updated', 'statuscategorychangedate', 'reporter', 'labels', 'components', 'fixVersions'];

function toIssue(i: any): JiraIssue {
  const f = i.fields || {};
  return {
    key: i.key,
    summary: f.summary || '',
    status: f.status?.name || 'Unknown',
    statusCategory: f.status?.statusCategory?.key || 'new',
    type: f.issuetype?.name || 'Task',
    priority: f.priority?.name || null,
    assignee: f.assignee?.displayName || null,
    created: f.created,
    resolved: f.resolutiondate || null,
    reporter: f.reporter?.displayName || null,
    labels: f.labels || [],
    components: (f.components || []).map((c: any) => c.name),
    fixVersions: (f.fixVersions || []).map((v: any) => v.name),
    updated: f.updated,
    statusChanged: f.statuscategorychangedate || null,
    url: jiraBrowseUrl(i.key),
  };
}

const authHeader = () => 'Basic ' + Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64');

// At most MAX_PARALLEL Jira requests in flight (a dashboard load fans out ~100 count queries; unbounded
// bursts risk Jira's 429 rate limit), one retry on 429 honouring Retry-After.
const MAX_PARALLEL = 6;
let inFlight = 0;
const waiters: Array<() => void> = [];
async function acquire() { if (inFlight >= MAX_PARALLEL) await new Promise<void>((r) => waiters.push(r)); inFlight++; }
function release() { inFlight--; waiters.shift()?.(); }

export async function jiraFetch<T = any>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  await acquire();
  try {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${BASE}${path}`, {
        method: init?.method || 'GET',
        headers: { Authorization: authHeader(), Accept: 'application/json', 'Content-Type': 'application/json' },
        body: init?.body ? JSON.stringify(init.body) : undefined,
        cache: 'no-store',
      });
      if (res.status === 429 && attempt === 0) {
        await new Promise((r) => setTimeout(r, Math.min(5, Number(res.headers.get('retry-after')) || 2) * 1000));
        continue;
      }
      if (!res.ok) throw new Error(`Jira ${res.status} ${path.split('?')[0]}: ${(await res.text()).slice(0, 200)}`);
      return res.json();
    }
  } finally {
    release();
  }
}

// Tiny per-instance cache so repeated dashboard loads (and several admins) don't each re-run ~100 Jira queries.
const memo = new Map<string, { at: number; value: unknown }>();
export async function cached<T>(key: string, ttlMs: number, fresh: boolean, fn: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (!fresh && hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await fn();
  memo.set(key, { at: Date.now(), value });
  return value;
}

// POST /rest/api/3/search/jql (the old /search endpoint was removed from Jira Cloud).
export async function jiraSearch(jql: string, maxIssues = 500): Promise<JiraIssue[]> {
  const issues: JiraIssue[] = [];
  let nextPageToken: string | undefined;
  while (issues.length < maxIssues) {
    const data = await jiraFetch('/rest/api/3/search/jql', {
      method: 'POST',
      body: { jql, fields: FIELDS, maxResults: Math.min(100, maxIssues - issues.length), nextPageToken },
    });
    issues.push(...(data.issues || []).map(toIssue));
    if (data.isLast || !data.nextPageToken) break;
    nextPageToken = data.nextPageToken;
  }
  return issues;
}

// Exact-enough issue count for a JQL query (not limited to a 500 sample).
export async function jiraCount(jql: string): Promise<number> {
  const data = await jiraFetch('/rest/api/3/search/approximate-count', { method: 'POST', body: { jql } });
  return data.count ?? 0;
}

export async function jiraIssuesByKeys(keys: string[]): Promise<Record<string, JiraIssue>> {
  const valid = [...new Set(keys.filter(isValidKey))].slice(0, 100);
  if (!valid.length) return {};
  const found = await jiraSearch(`key in (${valid.join(',')})`, 100);
  return Object.fromEntries(found.map((i) => [i.key, i]));
}

// ---- Workflow stages -------------------------------------------------------------------------
// Jira only has 3 status categories, but this workflow has many statuses inside "In Progress"
// (QA PASSED, PREVIEW DEPLOYED ...). Map status names to delivery stages; override the "shipped"
// set with JIRA_DONE_STATUSES (comma-separated status names) if the defaults are wrong.
export const STAGES = ['Backlog', 'In Development', 'Review / QA', 'QA Passed', 'Deployed / Done', 'Other'] as const;
export type Stage = (typeof STAGES)[number];

const EXTRA_DONE = (process.env.JIRA_DONE_STATUSES || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

export function stageOf(status: string, category?: string): Stage {
  const n = status.toLowerCase();
  if (EXTRA_DONE.includes(n)) return 'Deployed / Done';
  // "Preview Deployed" happens before QA, so it is not shipped.
  if (/preview/.test(n)) return 'Review / QA';
  if (category === 'done' || /\b(done|closed|resolved|released|deployed|live)\b/.test(n)) return 'Deployed / Done';
  if (/qa passed|passed qa|qa done|verified/.test(n)) return 'QA Passed';
  if (/ready for qa|in qa|testing|code review|ready for review|in review|qa/.test(n)) return 'Review / QA';
  if (/in development|in progress|developing/.test(n)) return 'In Development';
  if (/to-?do|backlog|ready for develop|on hold|open|new|selected/.test(n)) return 'Backlog';
  return 'Other';
}

// All statuses of the given projects: [{ name, category }]
export async function jiraProjectStatuses(projects: string[]): Promise<{ name: string; category: string }[]> {
  const all = await Promise.all(projects.map((p) => jiraFetch<any[]>(`/rest/api/3/project/${p}/statuses`)));
  const m = new Map<string, string>();
  for (const types of all) for (const t of types) for (const st of t.statuses || []) m.set(st.name, st.statusCategory?.key || 'new');
  return [...m].map(([name, category]) => ({ name, category }));
}

export const jqlStr = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// ---- Agile (sprint) --------------------------------------------------------------------------
export interface SprintSummary {
  name: string; goal: string | null; startDate: string | null; endDate: string | null; boardName: string;
  total: number; byStage: { name: string; value: number }[]; byStatus: { name: string; value: number }[];
}

export async function jiraActiveSprints(projectKey: string): Promise<SprintSummary[]> {
  const boards = await jiraFetch(`/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(projectKey)}&type=scrum&maxResults=10`);
  const out: SprintSummary[] = [];
  for (const b of (boards.values || []).slice(0, 3)) {
    let sprints: any;
    try { sprints = await jiraFetch(`/rest/agile/1.0/board/${b.id}/sprint?state=active`); } catch { continue; }
    for (const sp of sprints.values || []) {
      const issues: any[] = [];
      for (let start = 0; start < 500; start += 100) {
        const page = await jiraFetch(`/rest/agile/1.0/sprint/${sp.id}/issue?fields=status&maxResults=100&startAt=${start}`);
        issues.push(...(page.issues || []));
        if (start + 100 >= (page.total ?? 0)) break;
      }
      const byStatus: Record<string, number> = {}, byStage: Record<string, number> = {};
      for (const i of issues) {
        const st = i.fields?.status?.name || 'Unknown';
        byStatus[st] = (byStatus[st] || 0) + 1;
        const sg = stageOf(st, i.fields?.status?.statusCategory?.key);
        byStage[sg] = (byStage[sg] || 0) + 1;
      }
      const toList = (o: Record<string, number>) => Object.entries(o).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
      out.push({ name: sp.name, goal: sp.goal || null, startDate: sp.startDate || null, endDate: sp.endDate || null, boardName: b.name,
        total: issues.length, byStage: STAGES.filter((n) => byStage[n]).map((n) => ({ name: n, value: byStage[n] })), byStatus: toList(byStatus) });
    }
  }
  return out;
}

// ---- Deployments <-> tickets -------------------------------------------------------------------
export interface TicketDeploys { [key: string]: { [env: string]: { first: string; last: string } } }

// Jira keys found in recent successful deployments (notes, branches, versions, ticket link) and the
// environments they reached. `pool` is passed in to keep this file free of DB imports.
export async function ticketDeploys(pool: { query: (q: string) => Promise<{ rows: any[] }> }, limit = 300): Promise<TicketDeploys> {
  const { rows } = await pool.query(
    `SELECT environment, branch, version, frontend_branch, backend_branch, ticket_link, notes, started_at
     FROM deployments WHERE status = 'Success' ORDER BY started_at DESC LIMIT ${Math.floor(limit)}`
  );
  const out: TicketDeploys = {};
  for (const d of rows) {
    const t = new Date(d.started_at).toISOString();
    for (const key of extractJiraKeys(d.notes, d.branch, d.version, d.frontend_branch, d.backend_branch, d.ticket_link)) {
      const e = ((out[key] ??= {})[d.environment] ??= { first: t, last: t });
      if (t < e.first) e.first = t; // rows are newest-first, so keep overwriting `first`
    }
  }
  return out;
}

export const isProdEnv = (env: string) => /^production/i.test(env);

export const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
};
export const percentile = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.ceil((p / 100) * a.length) - 1)];
};

// ---- Dashboard filters -------------------------------------------------------------------------
// Query params (comma separated or repeated): assignee, reporter (Atlassian accountIds; assignee also accepts
// "unassigned"), type, priority, status, label, component, version; plus from/to (YYYY-MM-DD, on created) and q (text).
// Every value is validated and quoted, so request input can never inject JQL.
export const FILTER_KEYS = ['assignee', 'reporter', 'type', 'priority', 'status', 'label', 'component', 'version', 'from', 'to', 'q'] as const;

export function filterJql(sp: URLSearchParams): { clause: string; key: string } {
  const list = (name: string) => [...new Set(sp.getAll(name).flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean))].slice(0, 25);
  const names = (name: string) => list(name).filter((v) => v.length <= 100).map(jqlStr).join(', ');
  const ids = (name: string) => list(name).filter((v) => /^[A-Za-z0-9:_-]{1,128}$/.test(v));
  const parts: string[] = [];

  const a = ids('assignee').filter((v) => v !== 'unassigned');
  const unassigned = list('assignee').includes('unassigned');
  if (a.length || unassigned) parts.push(`(${[a.length ? `assignee in (${a.map(jqlStr).join(', ')})` : '', unassigned ? 'assignee is EMPTY' : ''].filter(Boolean).join(' OR ')})`);
  const r = ids('reporter'); if (r.length) parts.push(`reporter in (${r.map(jqlStr).join(', ')})`);
  for (const [param, field] of [['type', 'issuetype'], ['priority', 'priority'], ['status', 'status'], ['label', 'labels'], ['component', 'component'], ['version', 'fixVersion']] as const) {
    const v = names(param); if (v) parts.push(`${field} in (${v})`);
  }
  const date = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const from = date(sp.get('from')), to = date(sp.get('to'));
  if (from) parts.push(`created >= ${jqlStr(from)}`);
  if (to) parts.push(`created <= ${jqlStr(`${to} 23:59`)}`);
  const q = (sp.get('q') || '').trim().slice(0, 100);
  if (q) parts.push(`text ~ ${jqlStr(q)}`);

  return { clause: parts.length ? ` AND ${parts.join(' AND ')}` : '', key: parts.join('|') };
}

export const hasFilters = (sp: URLSearchParams) => FILTER_KEYS.some((k) => (sp.get(k) || '').trim() !== '');
