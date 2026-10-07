import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const REPOS: Record<string, string> = { frontend: 'vidaisolutions/vidai-react', backend: 'vidaisolutions/vidai-backend' };
const BRANCH = /^[A-Za-z0-9._/-]{1,100}$/; // branch name or commit sha
const PER_PAGE = 100;
const MAX_PAGES = 3; // newest 300 commits; beyond that link to GitHub

// GET /api/drift/commits?repo=backend&base=<sha|branch>&head=<branch>
// Every commit in base...head, newest first (the radar loads this when a chip is opened).
export async function GET(request: NextRequest) {
  const ghToken = process.env.GH_TOKEN;
  if (!ghToken) return NextResponse.json({ error: 'GitHub token not configured' }, { status: 500 });
  const sp = new URL(request.url).searchParams;
  const which = sp.get('repo') === 'frontend' ? 'frontend' : 'backend';
  const base = sp.get('base') || '', head = sp.get('head') || '';
  if (!BRANCH.test(base) || !BRANCH.test(head)) return NextResponse.json({ error: 'Bad base/head' }, { status: 400 });
  const repo = REPOS[which];
  const headers = { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const get = (page: number) => fetch(`https://api.github.com/repos/${repo}/compare/${base}...${head}?per_page=${PER_PAGE}&page=${page}`, { headers, cache: 'no-store' });

  try {
    const first = await get(1);
    if (!first.ok) return NextResponse.json({ error: `GitHub ${first.status}` }, { status: 502 });
    const d1 = await first.json();
    const total: number = d1.total_commits ?? d1.ahead_by ?? 0;
    const lastPage = Math.max(1, Math.ceil(total / PER_PAGE));
    // compare lists commits oldest -> newest, so the newest ones are on the last pages
    const wanted = Array.from({ length: Math.min(MAX_PAGES, lastPage) }, (_, k) => lastPage - k).filter((n) => n >= 1);
    const pages = await Promise.all(wanted.map(async (n) => (n === 1 ? d1 : (await (await get(n)).json()))));
    const commits = pages.flatMap((d: any) => d.commits || []);
    const rows = commits
      .sort((a: any, b: any) => new Date(b.commit.author?.date || 0).getTime() - new Date(a.commit.author?.date || 0).getTime())
      .map((c: any) => ({ sha: String(c.sha).slice(0, 7), message: String(c.commit.message).split('\n')[0], author: c.author?.login || c.commit.author?.name, url: c.html_url, date: c.commit.author?.date }));
    return NextResponse.json(
      { total, shown: rows.length, truncated: rows.length < total, compareUrl: `https://github.com/${repo}/compare/${base}...${head}`, commits: rows },
      { headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300' } }
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
