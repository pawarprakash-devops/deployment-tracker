import { NextResponse } from 'next/server';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_ORG = process.env.GITHUB_ORG || 'vidaisolutions';
const GH_API = 'https://api.github.com';
const GH_HEADERS = {
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

async function ghFetch(url: string) {
  const res = await fetch(url, { headers: GH_HEADERS, next: { revalidate: 300 } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${body}`);
  }
  return res.json();
}

async function downloadReport(downloadLinks: string[]): Promise<object[]> {
  if (!downloadLinks?.length) return [];
  const res = await fetch(downloadLinks[0]);
  if (!res.ok) throw new Error(`Report download failed: ${res.status}`);
  const text = await res.text();
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export async function GET() {
  if (!GITHUB_TOKEN) {
    return NextResponse.json({ error: 'GITHUB_TOKEN not configured' }, { status: 500 });
  }

  try {
    // 1. Seat info (billing overview)
    const billing = await ghFetch(`${GH_API}/orgs/${GITHUB_ORG}/copilot/billing`);

    // 2. All seats (per-user last activity)
    const seatsData = await ghFetch(`${GH_API}/orgs/${GITHUB_ORG}/copilot/billing/seats`);

    // 3. 28-day per-user usage report
    const userReport28 = await ghFetch(
      `${GH_API}/orgs/${GITHUB_ORG}/copilot/metrics/reports/users-28-day/latest`
    );
    const userRows = await downloadReport(userReport28.download_links);

    // 4. 28-day org-level report
    const orgReport28 = await ghFetch(
      `${GH_API}/orgs/${GITHUB_ORG}/copilot/metrics/reports/organization-28-day/latest`
    );
    const orgRows = await downloadReport(orgReport28.download_links);

    // Aggregate per-user rows into summary (sum over the 28-day window)
    const userSummaryMap: Record<string, {
      user_login: string;
      user_id: number;
      ai_credits_used: number;
      loc_suggested: number;
      loc_accepted: number;
      interactions: number;
      code_generations: number;
      code_acceptances: number;
      used_chat: boolean;
      used_agent: boolean;
      active_days: number;
      ai_adoption_phase: string;
    }> = {};

    for (const row of userRows as any[]) {
      const login = row.user_login;
      if (!userSummaryMap[login]) {
        userSummaryMap[login] = {
          user_login: login,
          user_id: row.user_id,
          ai_credits_used: 0,
          loc_suggested: 0,
          loc_accepted: 0,
          interactions: 0,
          code_generations: 0,
          code_acceptances: 0,
          used_chat: false,
          used_agent: false,
          active_days: 0,
          ai_adoption_phase: row.ai_adoption_phase?.phase || '',
        };
      }
      const u = userSummaryMap[login];
      u.ai_credits_used += row.ai_credits_used || 0;
      u.loc_suggested += row.loc_suggested_to_add_sum || 0;
      u.loc_accepted += row.loc_added_sum || 0;
      u.interactions += row.user_initiated_interaction_count || 0;
      u.code_generations += row.code_generation_activity_count || 0;
      u.code_acceptances += row.code_acceptance_activity_count || 0;
      if (row.used_chat) u.used_chat = true;
      if (row.used_agent) u.used_agent = true;
      if (
        (row.ai_credits_used || 0) > 0 ||
        (row.code_generation_activity_count || 0) > 0 ||
        (row.user_initiated_interaction_count || 0) > 0
      ) {
        u.active_days += 1;
      }
    }

    // Merge seat data (last_activity_at, last_activity_editor) into summary
    const seats = seatsData.seats || [];
    for (const seat of seats) {
      const login = seat.assignee?.login;
      if (!login) continue;
      if (!userSummaryMap[login]) {
        userSummaryMap[login] = {
          user_login: login,
          user_id: seat.assignee?.id,
          ai_credits_used: 0,
          loc_suggested: 0,
          loc_accepted: 0,
          interactions: 0,
          code_generations: 0,
          code_acceptances: 0,
          used_chat: false,
          used_agent: false,
          active_days: 0,
          ai_adoption_phase: '',
        };
      }
      (userSummaryMap[login] as any).last_activity_at = seat.last_activity_at;
      (userSummaryMap[login] as any).last_activity_editor = seat.last_activity_editor;
      (userSummaryMap[login] as any).last_authenticated_at = seat.last_authenticated_at;
      (userSummaryMap[login] as any).avatar_url = seat.assignee?.avatar_url;
      (userSummaryMap[login] as any).plan_type = seat.plan_type;
      (userSummaryMap[login] as any).pending_cancellation = !!seat.pending_cancellation_date;
    }

    const userSummary = Object.values(userSummaryMap).sort(
      (a, b) => b.ai_credits_used - a.ai_credits_used
    );

    // Org totals from orgRows
    const orgTotals = (orgRows as any[]).reduce(
      (acc, row) => {
        acc.ai_credits_used += row.ai_credits_used || 0;
        acc.loc_suggested += row.loc_suggested_to_add_sum || 0;
        acc.loc_accepted += row.loc_added_sum || 0;
        acc.interactions += row.user_initiated_interaction_count || 0;
        acc.code_generations += row.code_generation_activity_count || 0;
        return acc;
      },
      { ai_credits_used: 0, loc_suggested: 0, loc_accepted: 0, interactions: 0, code_generations: 0 }
    );

    return NextResponse.json({
      report_period: {
        start: userReport28.report_start_day,
        end: userReport28.report_end_day,
      },
      billing,
      org_totals: orgTotals,
      users: userSummary,
      raw_user_rows: userRows,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
