import type { NextRequest } from 'next/server';

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

// Same check as middleware.ts for write routes: Jira data (summaries, assignees) is internal,
// so unlike the other GET APIs these routes require the admin session.
export function isAdminRequest(request: NextRequest): boolean {
  const adminToken = process.env.ADMIN_TOKEN || 'admin-change-me';
  return (
    request.cookies.get('tracker_session')?.value === adminToken ||
    request.headers.get('authorization') === `Bearer ${adminToken}`
  );
}

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
  url: string;
}

const FIELDS = ['summary', 'status', 'issuetype', 'priority', 'assignee', 'created', 'resolutiondate'];

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
    url: jiraBrowseUrl(i.key),
  };
}

// POST /rest/api/3/search/jql (the old /search endpoint was removed from Jira Cloud).
export async function jiraSearch(jql: string, maxIssues = 500): Promise<JiraIssue[]> {
  const auth = 'Basic ' + Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64');
  const issues: JiraIssue[] = [];
  let nextPageToken: string | undefined;
  while (issues.length < maxIssues) {
    const res = await fetch(`${BASE}/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jql, fields: FIELDS, maxResults: Math.min(100, maxIssues - issues.length), nextPageToken }),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Jira ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    issues.push(...(data.issues || []).map(toIssue));
    if (data.isLast || !data.nextPageToken) break;
    nextPageToken = data.nextPageToken;
  }
  return issues;
}

export async function jiraIssuesByKeys(keys: string[]): Promise<Record<string, JiraIssue>> {
  const valid = [...new Set(keys.filter(isValidKey))].slice(0, 100);
  if (!valid.length) return {};
  const found = await jiraSearch(`key in (${valid.join(',')})`, 100);
  return Object.fromEntries(found.map((i) => [i.key, i]));
}
