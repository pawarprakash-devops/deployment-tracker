import { NextResponse } from 'next/server';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_ORG = process.env.GITHUB_ORG || 'vidaisolutions';

const GH_API = 'https://api.github.com';
const GH_HEADERS = {
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

interface SeatActivity {
  user_login: string;
  avatar_url: string;
  last_activity_at: string;
  last_activity_editor: string;
  last_authenticated_at: string;
  plan_type: string;
  status: string;
  minutes_since_active: number;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export async function GET() {
  if (!GITHUB_TOKEN) {
    return NextResponse.json({ error: 'GITHUB_TOKEN not configured' }, { status: 500 });
  }

  try {
    const seatsRes = await fetch(
      `${GH_API}/orgs/${GITHUB_ORG}/copilot/billing/seats`,
      { headers: GH_HEADERS, next: { revalidate: 0 } }
    );

    if (!seatsRes.ok) {
      throw new Error(`GitHub API error ${seatsRes.status}`);
    }

    const data = await seatsRes.json();
    const now = Date.now();

    const activity: SeatActivity[] = (data.seats || [])
      .map((seat: any) => {
        const login = seat.assignee?.login;
        const lastActive = seat.last_activity_at;
        const minutesSinceActive = lastActive
          ? Math.floor((now - new Date(lastActive).getTime()) / 60000)
          : Infinity;

        let status: string;
        if (minutesSinceActive === Infinity) {
          status = 'never_used';
        } else if (minutesSinceActive < 60) {
          status = 'active';
        } else if (minutesSinceActive < 1440) {
          status = 'today';
        } else if (minutesSinceActive < 10080) {
          status = 'this_week';
        } else {
          status = 'inactive';
        }

        return {
          user_login: login,
          avatar_url: seat.assignee?.avatar_url || '',
          last_activity_at: lastActive || null,
          last_activity_editor: seat.last_activity_editor || 'Unknown',
          last_authenticated_at: seat.last_authenticated_at || null,
          plan_type: seat.plan_type || 'enterprise',
          status,
          minutes_since_active: minutesSinceActive,
          time_ago: lastActive ? timeAgo(lastActive) : 'Never',
        };
      })
      .filter((s: SeatActivity) => s.user_login);

    activity.sort((a: SeatActivity, b: SeatActivity) =>
      a.minutes_since_active - b.minutes_since_active
    );

    const activeNow = activity.filter((a: SeatActivity) => a.status === 'active').length;
    const activeToday = activity.filter((a: SeatActivity) =>
      ['active', 'today'].includes(a.status)
    ).length;
    const activeThisWeek = activity.filter((a: SeatActivity) =>
      ['active', 'today', 'this_week'].includes(a.status)
    ).length;

    return NextResponse.json({
      fetched_at: new Date().toISOString(),
      summary: {
        total_seats: data.seat_breakdown?.total || activity.length,
        active_now: activeNow,
        active_today: activeToday,
        active_this_week: activeThisWeek,
        inactive: activity.length - activeThisWeek,
      },
      users: activity,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
