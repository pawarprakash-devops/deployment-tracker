import { NextResponse } from 'next/server';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_ORG = process.env.GITHUB_ORG || 'vidaisolutions';
// GitHub Copilot Enterprise: 3,500 included credits/user/month, resets 1st of month
// 1 credit = $0.01  →  3,500 credits = $35.00 cap per user per month
export const INCLUDED_CREDITS_PER_USER = parseInt(process.env.COPILOT_INCLUDED_CREDITS || '3500');
export const CREDITS_PER_DOLLAR = 100; // 100 credits = $1
export const BUDGET_PER_USER = INCLUDED_CREDITS_PER_USER / CREDITS_PER_DOLLAR; // $35.00

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

// Try to get a specific day report (returns null if not ready yet)
async function tryDailyReport(day: string): Promise<object[] | null> {
  try {
    const meta = await ghFetch(
      `${GH_API}/orgs/${GITHUB_ORG}/copilot/metrics/reports/users-1-day?day=${day}`
    );
    if (!meta?.download_links?.length) return null;
    return await downloadReport(meta.download_links);
  } catch {
    return null;
  }
}

export async function GET() {
  if (!GITHUB_TOKEN) {
    return NextResponse.json({ error: 'GITHUB_TOKEN not configured' }, { status: 500 });
  }

  try {
    // 1. Billing overview
    const billing = await ghFetch(`${GH_API}/orgs/${GITHUB_ORG}/copilot/billing`);

    // 2. All seats (last activity per user)
    const seatsData = await ghFetch(`${GH_API}/orgs/${GITHUB_ORG}/copilot/billing/seats`);

    // 3. 28-day per-user usage report
    const userReport28 = await ghFetch(
      `${GH_API}/orgs/${GITHUB_ORG}/copilot/metrics/reports/users-28-day/latest`
    );
    const userRows = await downloadReport(userReport28.download_links);

    // 4. Try to get today and yesterday daily reports for current-month accumulation
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const fmtDate = (d: Date) => d.toISOString().split('T')[0];

    const [todayRows, yesterdayRows] = await Promise.all([
      tryDailyReport(fmtDate(today)),
      tryDailyReport(fmtDate(yesterday)),
    ]);

    // Use most recent daily data available; fall back to 28-day
    const dailyRows = todayRows ?? yesterdayRows ?? null;
    const dailyDate = todayRows
      ? fmtDate(today)
      : yesterdayRows
      ? fmtDate(yesterday)
      : null;

    // --- Aggregate 28-day per-user ---
    const userMap: Record<string, any> = {};

    for (const row of userRows as any[]) {
      const login = row.user_login;
      if (!userMap[login]) {
        userMap[login] = {
          user_login: login,
          user_id: row.user_id,
          credits_28d: 0,
          dollars_28d: 0,
          loc_suggested: 0,
          loc_accepted: 0,
          interactions: 0,
          code_generations: 0,
          code_acceptances: 0,
          used_chat: false,
          used_agent: false,
          active_days: 0,
          ai_adoption_phase: row.ai_adoption_phase?.phase || '',
          // daily / current month
          credits_today: 0,
          dollars_today: 0,
        };
      }
      const u = userMap[login];
      u.credits_28d += row.ai_credits_used || 0;
      u.dollars_28d = u.credits_28d / CREDITS_PER_DOLLAR;
      u.loc_suggested += row.loc_suggested_to_add_sum || 0;
      u.loc_accepted += row.loc_added_sum || 0;
      u.interactions += row.user_initiated_interaction_count || 0;
      u.code_generations += row.code_generation_activity_count || 0;
      u.code_acceptances += row.code_acceptance_activity_count || 0;
      if (row.used_chat) u.used_chat = true;
      if (row.used_agent) u.used_agent = true;
      if ((row.ai_credits_used || 0) > 0 || (row.code_generation_activity_count || 0) > 0) {
        u.active_days += 1;
      }
    }

    // Merge daily data if available
    if (dailyRows) {
      for (const row of dailyRows as any[]) {
        const login = (row as any).user_login;
        if (!userMap[login]) continue;
        userMap[login].credits_today += (row as any).ai_credits_used || 0;
        userMap[login].dollars_today = userMap[login].credits_today / CREDITS_PER_DOLLAR;
      }
    }

    // Merge seat data
    for (const seat of seatsData.seats || []) {
      const login = seat.assignee?.login;
      if (!login) continue;
      if (!userMap[login]) {
        userMap[login] = {
          user_login: login,
          user_id: seat.assignee?.id,
          credits_28d: 0,
          dollars_28d: 0,
          loc_suggested: 0,
          loc_accepted: 0,
          interactions: 0,
          code_generations: 0,
          code_acceptances: 0,
          used_chat: false,
          used_agent: false,
          active_days: 0,
          ai_adoption_phase: '',
          credits_today: 0,
          dollars_today: 0,
        };
      }
      userMap[login].avatar_url = seat.assignee?.avatar_url;
      userMap[login].last_activity_at = seat.last_activity_at;
      userMap[login].last_activity_editor = seat.last_activity_editor;
      userMap[login].last_authenticated_at = seat.last_authenticated_at;
      userMap[login].plan_type = seat.plan_type;
      userMap[login].pending_cancellation = !!seat.pending_cancellation_date;
    }

    // Add budget fields — credits-first to match GitHub UI ("1,185 / 3,500 used")
    const users = Object.values(userMap).map((u) => ({
      ...u,
      // credits
      included_credits: INCLUDED_CREDITS_PER_USER,
      credits_used: Math.round(u.credits_28d),
      credits_remaining: Math.max(0, INCLUDED_CREDITS_PER_USER - Math.round(u.credits_28d)),
      credits_pct: Math.min(100, (u.credits_28d / INCLUDED_CREDITS_PER_USER) * 100),
      over_budget: u.credits_28d > INCLUDED_CREDITS_PER_USER,
      // dollars
      budget_cap: BUDGET_PER_USER,
      dollars_used: u.dollars_28d,
      dollars_remaining: Math.max(0, BUDGET_PER_USER - u.dollars_28d),
      budget_pct: Math.min(100, (u.dollars_28d / BUDGET_PER_USER) * 100),
    }));

    users.sort((a, b) => b.dollars_used - a.dollars_used);

    // Org totals — computed from per-user data (org-level report doesn't have ai_credits_used)
    const orgTotals = {
      ai_credits_used: users.reduce((sum, u) => sum + u.credits_used, 0),
      dollars: users.reduce((sum, u) => sum + u.dollars_used, 0),
      loc_suggested: users.reduce((sum, u) => sum + u.loc_suggested, 0),
      loc_accepted: users.reduce((sum, u) => sum + u.loc_accepted, 0),
      interactions: users.reduce((sum, u) => sum + u.interactions, 0),
      code_generations: users.reduce((sum, u) => sum + u.code_generations, 0),
    };

    return NextResponse.json({
      report_period: {
        start: userReport28.report_start_day,
        end: userReport28.report_end_day,
        daily_date: dailyDate,
      },
      billing,
      org_totals: orgTotals,
      budget_per_user: BUDGET_PER_USER,
      credits_per_dollar: CREDITS_PER_DOLLAR,
      users,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
