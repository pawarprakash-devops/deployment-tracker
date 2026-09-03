import { NextResponse } from 'next/server';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_ORG = process.env.GITHUB_ORG || 'vidaisolutions';

// GitHub Copilot Enterprise Configuration:
// 3,500 included credits per user per month (resets on 1st of calendar month)
// 1 credit = $0.01  →  3,500 credits = $35.00 cap per user
export const INCLUDED_CREDITS_PER_USER = parseInt(process.env.COPILOT_INCLUDED_CREDITS || '3500');
export const CREDITS_PER_DOLLAR = 100; // 100 credits = $1.00
export const BUDGET_PER_USER = INCLUDED_CREDITS_PER_USER / CREDITS_PER_DOLLAR; // $35.00

const GH_API = 'https://api.github.com';
const GH_HEADERS = {
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

async function ghFetch(url: string) {
  const res = await fetch(url, { headers: GH_HEADERS, next: { revalidate: 0 } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${body}`);
  }
  return res.json();
}

async function downloadReport(downloadLinks: string[]): Promise<any[]> {
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

// Fetch a single day metric report
async function tryDailyReport(day: string): Promise<{ day: string; rows: any[] | null }> {
  try {
    const meta = await ghFetch(
      `${GH_API}/orgs/${GITHUB_ORG}/copilot/metrics/reports/users-1-day?day=${day}`
    );
    if (!meta?.download_links?.length) return { day, rows: null };
    const rows = await downloadReport(meta.download_links);
    return { day, rows };
  } catch {
    return { day, rows: null };
  }
}

export async function GET() {
  if (!GITHUB_TOKEN) {
    return NextResponse.json({ error: 'GITHUB_TOKEN not configured' }, { status: 500 });
  }

  try {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-indexed (8 = September)
    const currentDay = now.getDate();

    // 1. Fetch billing seats and seat assignments
    const [billing, seatsData, userReport28] = await Promise.all([
      ghFetch(`${GH_API}/orgs/${GITHUB_ORG}/copilot/billing`),
      ghFetch(`${GH_API}/orgs/${GITHUB_ORG}/copilot/billing/seats`),
      ghFetch(`${GH_API}/orgs/${GITHUB_ORG}/copilot/metrics/reports/users-28-day/latest`),
    ]);

    const userRows28 = await downloadReport(userReport28.download_links);

    // 2. Fetch all daily reports for the current calendar month (from 1st of month to today)
    const daysInCurrentMonth: string[] = [];
    for (let d = 1; d <= currentDay; d++) {
      const monthStr = String(currentMonth + 1).padStart(2, '0');
      const dayStr = String(d).padStart(2, '0');
      daysInCurrentMonth.push(`${currentYear}-${monthStr}-${dayStr}`);
    }

    const dailyResults = await Promise.all(daysInCurrentMonth.map((day) => tryDailyReport(day)));
    const validDailyReports = dailyResults.filter(
      (d): d is { day: string; rows: any[] } => d.rows !== null
    );

    const availableDays = validDailyReports.map((d) => d.day).sort();
    const latestAvailableDate = availableDays.length > 0 ? availableDays[availableDays.length - 1] : null;

    // Reset date calculation: 1st of next month
    const nextMonth = new Date(currentYear, currentMonth + 1, 1);
    const msUntilReset = nextMonth.getTime() - now.getTime();
    const daysUntilReset = Math.ceil(msUntilReset / (1000 * 60 * 60 * 24));
    const nextMonthName = nextMonth.toLocaleString('default', { month: 'long' });
    const resetDateStr = `${nextMonthName} 1, ${nextMonth.getFullYear()}`;

    // Period label (e.g., "Sep 1 - Sep 30, 2026")
    const currentMonthName = now.toLocaleString('default', { month: 'short' });
    const lastDayOfCurrentMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const mtdPeriodLabel = `${currentMonthName} 1 - ${currentMonthName} ${lastDayOfCurrentMonth}, ${currentYear}`;

    // Initialize user map
    const userMap: Record<string, any> = {};

    // Base user setup from seats data
    for (const seat of seatsData.seats || []) {
      const login = seat.assignee?.login;
      if (!login) continue;
      userMap[login] = {
        user_login: login,
        user_id: seat.assignee?.id,
        avatar_url: seat.assignee?.avatar_url,
        last_activity_at: seat.last_activity_at,
        last_activity_editor: seat.last_activity_editor,
        last_authenticated_at: seat.last_authenticated_at,
        plan_type: seat.plan_type || 'enterprise',
        pending_cancellation: !!seat.pending_cancellation_date,
        ai_adoption_phase: '',
        // MTD (Month to date - Current month)
        credits_mtd: 0,
        dollars_mtd: 0,
        loc_suggested_mtd: 0,
        loc_accepted_mtd: 0,
        interactions_mtd: 0,
        code_generations_mtd: 0,
        code_acceptances_mtd: 0,
        active_days_mtd: 0,
        daily_credits: {},
        // 28-day rolling window
        credits_28d: 0,
        dollars_28d: 0,
        loc_suggested_28d: 0,
        loc_accepted_28d: 0,
        interactions_28d: 0,
        code_generations_28d: 0,
        code_acceptances_28d: 0,
        active_days_28d: 0,
        used_chat_28d: false,
        used_agent_28d: false,
      };
    }

    // 3. Aggregate 28-day data
    for (const row of userRows28) {
      const login = row.user_login;
      if (!userMap[login]) {
        userMap[login] = {
          user_login: login,
          user_id: row.user_id,
          avatar_url: undefined,
          last_activity_at: undefined,
          last_activity_editor: undefined,
          last_authenticated_at: undefined,
          plan_type: 'enterprise',
          pending_cancellation: false,
          ai_adoption_phase: row.ai_adoption_phase?.phase || '',
          credits_mtd: 0,
          dollars_mtd: 0,
          loc_suggested_mtd: 0,
          loc_accepted_mtd: 0,
          interactions_mtd: 0,
          code_generations_mtd: 0,
          code_acceptances_mtd: 0,
          active_days_mtd: 0,
          daily_credits: {},
          credits_28d: 0,
          dollars_28d: 0,
          loc_suggested_28d: 0,
          loc_accepted_28d: 0,
          interactions_28d: 0,
          code_generations_28d: 0,
          code_acceptances_28d: 0,
          active_days_28d: 0,
          used_chat_28d: false,
          used_agent_28d: false,
        };
      }
      const u = userMap[login];
      u.ai_adoption_phase = row.ai_adoption_phase?.phase || u.ai_adoption_phase;
      u.credits_28d += row.ai_credits_used || 0;
      u.dollars_28d = u.credits_28d / CREDITS_PER_DOLLAR;
      u.loc_suggested_28d += row.loc_suggested_to_add_sum || 0;
      u.loc_accepted_28d += row.loc_added_sum || 0;
      u.interactions_28d += row.user_initiated_interaction_count || 0;
      u.code_generations_28d += row.code_generation_activity_count || 0;
      u.code_acceptances_28d += row.code_acceptance_activity_count || 0;
      if (row.used_chat) u.used_chat_28d = true;
      if (row.used_agent) u.used_agent_28d = true;
      if ((row.ai_credits_used || 0) > 0 || (row.code_generation_activity_count || 0) > 0) {
        u.active_days_28d += 1;
      }
    }

    // 4. Aggregate MTD (Current Month) from daily reports
    const dailySummaries: Record<
      string,
      { date: string; credits: number; dollars: number; active_users: number }
    > = {};

    for (const report of validDailyReports) {
      const day = report.day;
      let dayCredits = 0;
      let dayActive = 0;

      for (const row of report.rows) {
        const login = row.user_login;
        if (!userMap[login]) {
          userMap[login] = {
            user_login: login,
            user_id: row.user_id,
            credits_mtd: 0,
            dollars_mtd: 0,
            loc_suggested_mtd: 0,
            loc_accepted_mtd: 0,
            interactions_mtd: 0,
            code_generations_mtd: 0,
            code_acceptances_mtd: 0,
            active_days_mtd: 0,
            daily_credits: {},
            credits_28d: 0,
            dollars_28d: 0,
            loc_suggested_28d: 0,
            loc_accepted_28d: 0,
            interactions_28d: 0,
            code_generations_28d: 0,
            code_acceptances_28d: 0,
            active_days_28d: 0,
            used_chat_28d: false,
            used_agent_28d: false,
            ai_adoption_phase: row.ai_adoption_phase?.phase || '',
          };
        }
        const u = userMap[login];
        const credits = row.ai_credits_used || 0;
        u.credits_mtd += credits;
        u.dollars_mtd = u.credits_mtd / CREDITS_PER_DOLLAR;
        u.loc_suggested_mtd += row.loc_suggested_to_add_sum || 0;
        u.loc_accepted_mtd += row.loc_added_sum || 0;
        u.interactions_mtd += row.user_initiated_interaction_count || 0;
        u.code_generations_mtd += row.code_generation_activity_count || 0;
        u.code_acceptances_mtd += row.code_acceptance_activity_count || 0;
        if (credits > 0 || (row.code_generation_activity_count || 0) > 0) {
          u.active_days_mtd += 1;
          dayActive += 1;
        }
        u.daily_credits[day] = credits;
        dayCredits += credits;
      }

      dailySummaries[day] = {
        date: day,
        credits: dayCredits,
        dollars: dayCredits / CREDITS_PER_DOLLAR,
        active_users: dayActive,
      };
    }

    // Total Enterprise Included credits: 14 seats * 3,900 = 54,600 (or custom)
    const totalSeats = billing.seat_breakdown?.total || Object.keys(userMap).length || 14;
    const totalIncludedCredits = totalSeats * 3900; // 54,600 credits
    const totalMtdCredits = Object.values(userMap).reduce((sum, u) => sum + u.credits_mtd, 0);
    const totalMtdDollars = totalMtdCredits / CREDITS_PER_DOLLAR;

    // Build finalized users array with MTD as primary, matching GitHub UI
    const users = Object.values(userMap).map((u) => {
      // Primary view = Month-To-Date (MTD)
      const creditsUsed = u.credits_mtd;
      const dollarsUsed = u.dollars_mtd;
      const includedCredits = INCLUDED_CREDITS_PER_USER;
      const budgetCap = BUDGET_PER_USER;

      const creditsRemaining = Math.max(0, includedCredits - creditsUsed);
      const creditsPct = Math.min(100, (creditsUsed / includedCredits) * 100);
      const overBudget = creditsUsed > includedCredits;
      const overageCredits = Math.max(0, creditsUsed - includedCredits);
      const overageDollars = overageCredits / CREDITS_PER_DOLLAR;

      return {
        ...u,
        // Primary fields (MTD)
        ai_credits_used: creditsUsed,
        dollars_used: dollarsUsed,
        loc_suggested: u.loc_suggested_mtd,
        loc_accepted: u.loc_accepted_mtd,
        interactions: u.interactions_mtd,
        code_generations: u.code_generations_mtd,
        code_acceptances: u.code_acceptances_mtd,
        active_days: u.active_days_mtd,
        // Budgeting
        included_credits: includedCredits,
        credits_used: creditsUsed,
        credits_remaining: creditsRemaining,
        credits_pct: creditsPct,
        over_budget: overBudget,
        overage_credits: overageCredits,
        overage_dollars: overageDollars,
        budget_cap: budgetCap,
        dollars_remaining: Math.max(0, budgetCap - dollarsUsed),
        budget_pct: Math.min(100, (dollarsUsed / budgetCap) * 100),
      };
    });

    // Sort by MTD credits descending
    users.sort((a, b) => b.credits_mtd - a.credits_mtd);

    // Organization totals
    const orgTotals = {
      ai_credits_used: Math.round(totalMtdCredits * 100) / 100,
      dollars: Math.round(totalMtdDollars * 100) / 100,
      loc_suggested: users.reduce((sum, u) => sum + u.loc_suggested_mtd, 0),
      loc_accepted: users.reduce((sum, u) => sum + u.loc_accepted_mtd, 0),
      interactions: users.reduce((sum, u) => sum + u.interactions_mtd, 0),
      code_generations: users.reduce((sum, u) => sum + u.code_generations_mtd, 0),
      // 28-day totals for reference
      rolling_28d_credits: Math.round(users.reduce((sum, u) => sum + u.credits_28d, 0) * 100) / 100,
      rolling_28d_dollars: Math.round(users.reduce((sum, u) => sum + u.dollars_28d, 0) * 100) / 100,
    };

    return NextResponse.json({
      report_period: {
        start: `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`,
        end: `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(lastDayOfCurrentMonth).padStart(2, '0')}`,
        daily_date: latestAvailableDate,
        is_mtd: true,
        period_label: mtdPeriodLabel,
        days_in_period: availableDays.length,
        available_days: availableDays,
        reset_date_str: resetDateStr,
        days_until_reset: daysUntilReset,
        rolling_28d_start: userReport28.report_start_day,
        rolling_28d_end: userReport28.report_end_day,
      },
      billing,
      enterprise_limits: {
        total_included_credits: totalIncludedCredits,
        consumed_credits: Math.round(totalMtdCredits * 100) / 100,
        remaining_credits: Math.max(0, Math.round((totalIncludedCredits - totalMtdCredits) * 100) / 100),
        consumed_pct: Math.min(100, (totalMtdCredits / totalIncludedCredits) * 100),
        additional_usage_dollars: 0.0,
        gross_spend_dollars: Math.round(totalMtdDollars * 100) / 100,
        budget_per_user: BUDGET_PER_USER,
        credits_per_dollar: CREDITS_PER_DOLLAR,
      },
      org_totals: orgTotals,
      daily_history: Object.values(dailySummaries).sort((a, b) => a.date.localeCompare(b.date)),
      budget_per_user: BUDGET_PER_USER,
      credits_per_dollar: CREDITS_PER_DOLLAR,
      users,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
