import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Promotion pipeline: each pair is [upstream branch, downstream branch]; "pending" = commits on the
// upstream branch that the downstream branch does not have yet.
const PAIRS: { from: string; to: string; fromEnv: string; toEnv: string }[] = [
  { from: 'dev', to: 'qa', fromEnv: 'Preview', toEnv: 'QA' },
  { from: 'qa', to: 'stage', fromEnv: 'QA', toEnv: 'Stage' },
  { from: 'stage', to: 'preprod', fromEnv: 'Stage', toEnv: 'Pre-Prod' },
  { from: 'preprod', to: 'prod_ank', fromEnv: 'Pre-Prod', toEnv: 'Production (Ankura)' },
  { from: 'preprod', to: 'prod_neo', fromEnv: 'Pre-Prod', toEnv: 'Production (Neotia/Babyjoy)' },
];
const REPOS: Record<string, string> = { frontend: 'vidaisolutions/vidai-react', backend: 'vidaisolutions/vidai-backend' };

// GET /api/drift?repo=frontend|backend   (public read, like /api/compare; needs GH_TOKEN on the server)
export async function GET(request: NextRequest) {
  const ghToken = process.env.GH_TOKEN;
  if (!ghToken) return NextResponse.json({ error: 'GitHub token not configured' }, { status: 500 });
  const which = new URL(request.url).searchParams.get('repo') === 'backend' ? 'backend' : 'frontend';
  const repo = REPOS[which];
  const headers = { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };

  const pairs = await Promise.all(PAIRS.map(async (p) => {
    try {
      // base = downstream, head = upstream  ->  ahead_by = commits waiting to be promoted
      const res = await fetch(`https://api.github.com/repos/${repo}/compare/${p.to}...${p.from}?per_page=15`, { headers, cache: 'no-store' });
      if (!res.ok) return { ...p, error: `GitHub ${res.status}` };
      const d = await res.json();
      return {
        ...p, status: d.status as string, pending: d.ahead_by as number, behind: d.behind_by as number,
        commits: (d.commits || []).slice(-15).reverse().map((c: any) => ({
          sha: String(c.sha).slice(0, 7), message: String(c.commit.message).split('\n')[0], author: c.author?.login || c.commit.author?.name, url: c.html_url, date: c.commit.author?.date,
        })),
      };
    } catch (e) {
      return { ...p, error: e instanceof Error ? e.message : String(e) };
    }
  }));

  return NextResponse.json({ repo, which, pairs }, { headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300' } });
}
