import { NextRequest, NextResponse } from 'next/server';
import { cached, canReadJira, jiraConfigured, jiraFetch, jiraProjectStatuses, JIRA_PROJECTS } from '@/lib/jira';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// GET /api/jira/filters (admin session required): option lists for the dashboard filter bar.
export async function GET(request: NextRequest) {
  if (!canReadJira(request)) return NextResponse.json({ error: 'Admin login required' }, { status: 401 });
  if (!jiraConfigured()) return NextResponse.json({ configured: false });
  if (!JIRA_PROJECTS.length) return NextResponse.json({ configured: true, error: 'Set JIRA_PROJECT_KEYS' }, { status: 400 });
  try {
    const out = await cached('filters', 3600000, new URL(request.url).searchParams.get('fresh') === '1', async () => {
      const opt = <T,>(p: Promise<T>, d: T) => p.catch(() => d);
      const [statuses, users, priorities, labels, comps, vers, types] = await Promise.all([
        jiraProjectStatuses(JIRA_PROJECTS),
        Promise.all(JIRA_PROJECTS.map((k) => opt(jiraFetch<any[]>(`/rest/api/3/user/assignable/search?project=${k}&maxResults=200`), []))),
        opt(jiraFetch<any>('/rest/api/3/priority/search?maxResults=50'), { values: [] }),
        opt(jiraFetch<any>('/rest/api/3/label?maxResults=500'), { values: [] }),
        Promise.all(JIRA_PROJECTS.map((k) => opt(jiraFetch<any[]>(`/rest/api/3/project/${k}/components`), []))),
        Promise.all(JIRA_PROJECTS.map((k) => opt(jiraFetch<any[]>(`/rest/api/3/project/${k}/versions`), []))),
        Promise.all(JIRA_PROJECTS.map((k) => opt(jiraFetch<any[]>(`/rest/api/3/project/${k}/statuses`), []))),
      ]);
      const people = new Map<string, string>();
      for (const u of users.flat()) if (u.active !== false && u.accountType !== 'app' && u.accountId) people.set(u.accountId, u.displayName);
      const uniq = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b));
      return {
        configured: true,
        people: [...people].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
        types: uniq(types.flat().map((t: any) => t.name)),
        statuses: statuses.map((s) => s.name).sort(),
        priorities: (priorities.values || []).map((p: any) => p.name),
        labels: (labels.values || []) as string[],
        components: uniq(comps.flat().map((c: any) => c.name)),
        versions: uniq(vers.flat().map((v: any) => v.name)).reverse(),
      };
    });
    return NextResponse.json(out, { headers: { 'Cache-Control': 'private, max-age=600' } });
  } catch (e) {
    return NextResponse.json({ configured: true, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
