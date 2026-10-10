import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Promotion pipeline: each pair is [upstream branch, downstream branch]; "pending" = commits on the
// upstream branch since the last promotion PR into the downstream branch.
// Promotion chain (stage is not on the path):
//   dev (Preview) -> qa (QA) -> demo (Demo-Preview)
//                            -> preprod (Pre-Prod India) -> preprod_usw (Pre-Prod USW) -> prod_usw (Production USW)
//                                                        -> prod_neo (Production Neotia/Babyjoy)
//                                                        -> prod_ank (Production Ankura; mostly cherry-pick/release PRs)
// A branch that does not exist yet (e.g. prod_usw before go-live) is reported per pair as `missingBranch`
// (plus a readable `error`), so the rest of the response is unaffected.
const PAIRS: { from: string; to: string; fromEnv: string; toEnv: string }[] = [
  { from: 'dev', to: 'qa', fromEnv: 'Preview', toEnv: 'QA' },
  { from: 'qa', to: 'preprod', fromEnv: 'QA', toEnv: 'Pre-Prod' },
  { from: 'qa', to: 'demo', fromEnv: 'QA', toEnv: 'Demo-Preview' },
  { from: 'preprod', to: 'prod_neo', fromEnv: 'Pre-Prod', toEnv: 'Production (Neotia/Babyjoy)' },
  { from: 'preprod', to: 'prod_ank', fromEnv: 'Pre-Prod', toEnv: 'Production (Ankura)' },
  { from: 'preprod', to: 'preprod_usw', fromEnv: 'Pre-Prod', toEnv: 'Pre-Prod USW' },
  { from: 'preprod_usw', to: 'prod_usw', fromEnv: 'Pre-Prod USW', toEnv: 'Production USW' },
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

      const res = await gh(`compare/${baseRef}...${p.from}?per_page=1`);
      if (!res.ok) {
        // A 404 can mean a branch does not exist yet (e.g. prod_usw before go-live) or an unreachable SHA.
        // Only report "branch not found" when GitHub confirms the branch itself is missing.
        if (res.status === 404) {
          for (const b of [p.to, p.from]) {
            const br = await gh(`branches/${encodeURIComponent(b)}`);
            if (br.status === 404) return { ...p, missingBranch: b, error: `branch ${b} not found` };
          }
        }
        return { ...p, error: `GitHub ${res.status}` };
      }
      const d = await res.json();
      return { ...p, basis, promotion, baseRef, status: d.status as string, pending: d.ahead_by as number, behind: d.behind_by as number };
    } catch (e) {
      return { ...p, error: e instanceof Error ? e.message : String(e) };
    }
  }));

  return NextResponse.json({ repo, which, pairs }, { headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300' } });
}
