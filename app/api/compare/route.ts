import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const repo = searchParams.get('repo') || 'vidaisolutions/vidai-react';
    const base = searchParams.get('base'); // older commit/branch/tag
    const head = searchParams.get('head'); // newer commit/branch/tag
    const runId = searchParams.get('run_id'); // GitHub Actions run ID

    const ghToken = process.env.GH_TOKEN;
    if (!ghToken) {
      return NextResponse.json({ error: 'GitHub token not configured' }, { status: 500 });
    }

    const headers = {
      'Authorization': `Bearer ${ghToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };

    // If run_id is provided, fetch the run details to get head SHA
    let headSha = head;
    let baseSha = base;
    let runDetails: any = null;

    if (runId) {
      const runRes = await fetch(
        `https://api.github.com/repos/vidaisolutions/vidai-devops/actions/runs/${runId}`,
        { headers }
      );
      if (runRes.ok) {
        runDetails = await runRes.json();
      }
    }

    // If we have both base and head, compare commits
    if (baseSha && headSha) {
      const compareRes = await fetch(
        `https://api.github.com/repos/${repo}/compare/${baseSha}...${headSha}`,
        { headers }
      );

      if (compareRes.ok) {
        const compareData = await compareRes.json();
        return NextResponse.json({
          status: compareData.status, // ahead, behind, identical, diverged
          ahead_by: compareData.ahead_by,
          behind_by: compareData.behind_by,
          total_commits: compareData.total_commits,
          commits: compareData.commits?.slice(0, 30).map((c: any) => ({
            sha: c.sha,
            short_sha: c.sha.substring(0, 7),
            message: c.commit.message,
            author: c.commit.author.name,
            author_login: c.author?.login,
            author_avatar: c.author?.avatar_url,
            date: c.commit.author.date,
            url: c.html_url
          })),
          files: compareData.files?.slice(0, 50).map((f: any) => ({
            filename: f.filename,
            status: f.status, // added, removed, modified, renamed
            additions: f.additions,
            deletions: f.deletions,
            changes: f.changes
          })),
          files_changed: compareData.files?.length || 0,
          run_details: runDetails ? {
            id: runDetails.id,
            name: runDetails.name,
            status: runDetails.status,
            conclusion: runDetails.conclusion,
            actor: runDetails.actor?.login,
            created_at: runDetails.created_at,
            updated_at: runDetails.updated_at,
            head_sha: runDetails.head_sha,
            head_branch: runDetails.head_branch
          } : null
        });
      } else {
        const err = await compareRes.json();
        return NextResponse.json({ 
          error: 'GitHub compare failed', 
          details: err.message,
          status_code: compareRes.status
        }, { status: 422 });
      }
    }

    // If only head branch is provided, get recent commits on that branch
    if (headSha) {
      const commitsRes = await fetch(
        `https://api.github.com/repos/${repo}/commits?sha=${encodeURIComponent(headSha)}&per_page=15`,
        { headers }
      );

      if (commitsRes.ok) {
        const commitsData = await commitsRes.json();
        return NextResponse.json({
          total_commits: commitsData.length,
          commits: commitsData.map((c: any) => ({
            sha: c.sha,
            short_sha: c.sha.substring(0, 7),
            message: c.commit.message,
            author: c.commit.author.name,
            author_login: c.author?.login,
            author_avatar: c.author?.avatar_url,
            date: c.commit.author.date,
            url: c.html_url
          })),
          run_details: runDetails
        });
      }
    }

    return NextResponse.json({ error: 'Provide base & head, or head, or run_id' }, { status: 400 });
  } catch (error) {
    console.error('GitHub API error:', error);
    return NextResponse.json({ error: 'Failed to fetch from GitHub' }, { status: 500 });
  }
}
