import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Promotion pipeline: each pair is [upstream branch, downstream branch]; "pending" = commits on the
// upstream branch since the last promotion PR into the downstream branch.
// Active flow observed in vidai-backend PRs: dev -> qa -> preprod (QA promotes straight to preprod; `stage` is
// not on the path), qa -> demo (Demo-Preview), preprod -> prod_neo via promotion PRs, prod_ank is updated by cherry-pick/release PRs.
const PAIRS: { from: string; to: string; fromEnv: string; toEnv: string }[] = [
  { from: 'dev', to: 'qa', fromEnv: 'Preview', toEnv: 'QA' },
  { from: 'qa', to: 'preprod', fromEnv: 'QA', toEnv: 'Pre-Prod' },
  { from: 'qa', to: 'demo', fromEnv: 'QA', toEnv: 'Demo-Preview' },
  { from: 'preprod', to: 'prod_neo', fromEnv: 'Pre-Prod', toEnv: 'Production (Neotia/Babyjoy)' },
  { from: 'preprod', to: 'prod_ank', fromEnv: 'Pre-Prod', toEnv: 'Production (Ankura)' },
];
const REPOS: Record<string, string> = { frontend: 'vidaisolutions/vidai-react', backend: 'vidaisolutions/vidai-backend' };

// GET /api/drift?repo=frontend|backend   (public read, like /api/compare; needs GH_TOKEN on the server)
export async function GET(request: NextRequest) {
  const ghToken = process.env.GH_TOKEN;
  if (!ghToken) return NextResponse.json({ error: 'GitHub token not configured' }, { status: 500 });
  const which = new URL(request.url).searchParams.get('repo') === 'backend' ? 'backend' : 'frontend';
  const repo = REPOS[which];
  const headers = { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };

  const owner = repo.split('/')[0];
  const gh = (path: string) => fetch(`https://api.github.com/repos/${repo}/${path}`, { headers, cache: 'no-store' });

  const pairs = await Promise.all(PAIRS.map(async (p) => {
    try {
      // Squash / merge-commit promotions give the same change a new SHA on every branch, so a plain
      // downstream...upstream compare counts every old commit as "pending". Instead anchor on the last
      // merged promotion PR (head = upstream, base = downstream): its head SHA is the upstream tip that was
      // promoted, so upstream's own history gives an exact "commits since last promotion".
      let basis: 'promotion-pr' | 'branch-compare' = 'branch-compare';
      let baseRef = p.to; // fallback: plain branch compare
      let promotion: { number: number; url: string; mergedAt: string } | undefined;

      const prs = await gh(`pulls?state=closed&base=${encodeURIComponent(p.to)}&head=${encodeURIComponent(`${owner}:${p.from}`)}&sort=updated&direction=desc&per_page=10`);
      if (prs.ok) {
        const merged = (await prs.json()).find((x: any) => x.merged_at);
        if (merged?.head?.sha) {
          baseRef = merged.head.sha; basis = 'promotion-pr';
          promotion = { number: merged.number, url: merged.html_url, mergedAt: merged.merged_at };
        }
      }

      const res = await gh(`compare/${baseRef}...${p.from}?per_page=15`);
      if (!res.ok) return { ...p, error: `GitHub ${res.status}` };
      const d = await res.json();
      return {
        ...p, basis, promotion, status: d.status as string, pending: d.ahead_by as number, behind: d.behind_by as number,
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
