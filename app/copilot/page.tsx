'use client';

import { useState, useEffect, useCallback } from 'react';

interface UserSummary {
  user_login: string;
  user_id: number;
  avatar_url?: string;
  last_activity_at?: string;
  last_activity_editor?: string;
  last_authenticated_at?: string;
  plan_type?: string;
  pending_cancellation?: boolean;
  ai_adoption_phase: string;
  // MTD (Month-To-Date / Current Month)
  credits_mtd: number;
  dollars_mtd: number;
  loc_suggested_mtd: number;
  loc_accepted_mtd: number;
  interactions_mtd: number;
  code_generations_mtd: number;
  code_acceptances_mtd: number;
  active_days_mtd: number;
  daily_credits: Record<string, number>;
  // 28-day rolling window
  credits_28d: number;
  dollars_28d: number;
  loc_suggested_28d: number;
  loc_accepted_28d: number;
  interactions_28d: number;
  code_generations_28d: number;
  code_acceptances_28d: number;
  active_days_28d: number;
  used_chat_28d?: boolean;
  used_agent_28d?: boolean;
  // Computed Budget
  included_credits: number;
  credits_used: number;
  credits_remaining: number;
  credits_pct: number;
  over_budget: boolean;
  overage_credits: number;
  overage_dollars: number;
  dollars_used: number;
  dollars_remaining: number;
  budget_pct: number;
}

interface Billing {
  seat_breakdown: {
    total: number;
    active_this_cycle: number;
    inactive_this_cycle: number;
    added_this_cycle: number;
    pending_cancellation: number;
    pending_invitation: number;
  };
  plan_type: string;
  ide_chat: string;
  cli: string;
  platform_chat: string;
}

interface EnterpriseLimits {
  total_included_credits: number;
  consumed_credits: number;
  remaining_credits: number;
  consumed_pct: number;
  additional_usage_dollars: number;
  gross_spend_dollars: number;
  budget_per_user: number;
  credits_per_dollar: number;
}

interface DailyHistoryItem {
  date: string;
  credits: number;
  dollars: number;
  active_users: number;
}

interface OrgTotals {
  ai_credits_used: number;
  dollars: number;
  loc_suggested: number;
  loc_accepted: number;
  interactions: number;
  code_generations: number;
  rolling_28d_credits?: number;
  rolling_28d_dollars?: number;
}

interface CopilotData {
  report_period: {
    start: string;
    end: string;
    daily_date?: string | null;
    is_mtd: boolean;
    period_label: string;
    days_in_period: number;
    available_days: string[];
    reset_date_str: string;
    days_until_reset: number;
    rolling_28d_start?: string;
    rolling_28d_end?: string;
  };
  billing: Billing;
  enterprise_limits: EnterpriseLimits;
  org_totals: OrgTotals;
  daily_history: DailyHistoryItem[];
  budget_per_user: number;
  credits_per_dollar: number;
  users: UserSummary[];
}

function fmt(n: number, decimals = 0) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return n.toFixed(decimals);
}

function timeAgo(dateStr?: string) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function editorLabel(str?: string) {
  if (!str) return '—';
  if (str.includes('copilot-chat')) return 'VS Code Chat';
  if (str.includes('vscode')) return 'VS Code';
  if (str.includes('jetbrains')) return 'JetBrains';
  if (str.includes('neovim')) return 'Neovim';
  if (str.includes('vim')) return 'Vim';
  return str.split('/')[0];
}

function acceptanceRate(accepted: number, suggested: number) {
  if (!suggested) return '—';
  return ((accepted / suggested) * 100).toFixed(1) + '%';
}

function phaseColor(phase: string) {
  if (phase.includes('1')) return 'bg-red-900/50 text-red-300 border border-red-800/40';
  if (phase.includes('2')) return 'bg-yellow-900/50 text-yellow-300 border border-yellow-800/40';
  if (phase.includes('3')) return 'bg-blue-900/50 text-blue-300 border border-blue-800/40';
  if (phase.includes('4')) return 'bg-green-900/50 text-green-300 border border-green-800/40';
  return 'bg-gray-800 text-gray-400 border border-gray-700/50';
}

type ViewMode = 'mtd' | 'daily' | 'rolling_28d';
type FilterStatus = 'all' | 'over_budget' | 'under_budget' | 'inactive';

export default function CopilotPage() {
  const [data, setData] = useState<CopilotData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('mtd');
  const [selectedDay, setSelectedDay] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<string>('credits');
  const [sortAsc, setSortAsc] = useState(false);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(300);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/copilot');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fetch Copilot usage');
      setData(json);
      if (json.report_period?.available_days?.length && !selectedDay) {
        setSelectedDay(json.report_period.available_days[json.report_period.available_days.length - 1]);
      }
      setLastFetched(new Date());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedDay]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh timer
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          fetchData();
          return 300;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [autoRefresh, fetchData]);

  const handleRefresh = () => {
    setCountdown(300);
    fetchData();
  };

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  // Filter and sort users based on viewMode
  const filteredUsers = (data?.users || [])
    .filter((u) => {
      // Search
      const matchSearch =
        u.user_login.toLowerCase().includes(search.toLowerCase()) ||
        (u.last_activity_editor && u.last_activity_editor.toLowerCase().includes(search.toLowerCase())) ||
        (u.ai_adoption_phase && u.ai_adoption_phase.toLowerCase().includes(search.toLowerCase()));
      if (!matchSearch) return false;

      // Status filter
      if (statusFilter === 'over_budget') return u.over_budget;
      if (statusFilter === 'under_budget') return !u.over_budget && u.credits_mtd > 0;
      if (statusFilter === 'inactive') return u.credits_mtd === 0 && u.code_generations_mtd === 0;
      return true;
    })
    .sort((a, b) => {
      let av = 0;
      let bv = 0;

      if (viewMode === 'mtd') {
        if (sortKey === 'credits') { av = a.credits_mtd; bv = b.credits_mtd; }
        else if (sortKey === 'loc_suggested') { av = a.loc_suggested_mtd; bv = b.loc_suggested_mtd; }
        else if (sortKey === 'loc_accepted') { av = a.loc_accepted_mtd; bv = b.loc_accepted_mtd; }
        else if (sortKey === 'interactions') { av = a.interactions_mtd; bv = b.interactions_mtd; }
        else if (sortKey === 'code_gen') { av = a.code_generations_mtd; bv = b.code_generations_mtd; }
        else if (sortKey === 'user') { return sortAsc ? a.user_login.localeCompare(b.user_login) : b.user_login.localeCompare(a.user_login); }
      } else if (viewMode === 'daily') {
        const dayA = a.daily_credits[selectedDay] || 0;
        const dayB = b.daily_credits[selectedDay] || 0;
        if (sortKey === 'credits') { av = dayA; bv = dayB; }
        else { av = a.credits_mtd; bv = b.credits_mtd; }
      } else {
        // rolling_28d
        if (sortKey === 'credits') { av = a.credits_28d; bv = b.credits_28d; }
        else if (sortKey === 'loc_suggested') { av = a.loc_suggested_28d; bv = b.loc_suggested_28d; }
        else if (sortKey === 'loc_accepted') { av = a.loc_accepted_28d; bv = b.loc_accepted_28d; }
        else if (sortKey === 'interactions') { av = a.interactions_28d; bv = b.interactions_28d; }
        else if (sortKey === 'code_gen') { av = a.code_generations_28d; bv = b.code_generations_28d; }
        else if (sortKey === 'user') { return sortAsc ? a.user_login.localeCompare(b.user_login) : b.user_login.localeCompare(a.user_login); }
      }

      return sortAsc ? av - bv : bv - av;
    });

  const overBudgetCount = (data?.users || []).filter((u) => u.over_budget).length;
  const underBudgetCount = (data?.users || []).filter((u) => !u.over_budget && u.credits_mtd > 0).length;
  const inactiveCount = (data?.users || []).filter((u) => u.credits_mtd === 0 && u.code_generations_mtd === 0).length;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-4 md:p-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <a href="/" className="text-gray-400 hover:text-white text-sm transition-colors">
            ← Deployments
          </a>
          <span className="text-gray-600">/</span>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <span className="text-2xl">🤖</span> GitHub Copilot AI Usage
          </h1>
          <span className="text-xs bg-purple-950/70 border border-purple-800 text-purple-300 font-semibold px-2 py-0.5 rounded">
            Enterprise
          </span>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {lastFetched && (
            <span className="text-xs text-gray-400">
              Updated {timeAgo(lastFetched.toISOString())}
              {autoRefresh && (
                <span className="ml-2 text-blue-400">
                  · Refresh in {Math.floor(countdown / 60)}:{(countdown % 60).toString().padStart(2, '0')}
                </span>
              )}
            </span>
          )}
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => {
                setAutoRefresh(e.target.checked);
                if (e.target.checked) setCountdown(300);
              }}
              className="w-3.5 h-3.5 rounded border-gray-700 bg-gray-900 text-blue-500 focus:ring-blue-500"
            />
            <span className="text-xs text-gray-400">Auto</span>
          </label>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-sm font-medium transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <span>↻</span>
            <span>{loading ? 'Refreshing…' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-950/60 border border-red-800 text-red-300 rounded-lg p-4 mb-6 text-sm">
          ⚠️ {error}
        </div>
      )}

      {loading && !data && (
        <div className="flex flex-col items-center justify-center h-72 text-gray-400 gap-3">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p>Loading GitHub Copilot Enterprise metrics…</p>
        </div>
      )}

      {data && (
        <>
          {/* Top Enterprise Hero Cards (Matching GitHub Enterprise UI) */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {/* Card 1: Included Credits */}
            <div className="bg-gray-900/90 border border-gray-800 rounded-xl p-5 flex flex-col justify-between shadow-lg">
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Included Credits</p>
                <div className="flex items-baseline gap-2 mb-2">
                  <span className="text-3xl font-extrabold text-white">
                    {data.enterprise_limits.consumed_credits.toLocaleString()}
                  </span>
                  <span className="text-sm font-medium text-gray-400">
                    / {data.enterprise_limits.total_included_credits.toLocaleString()} AI credits
                  </span>
                </div>
                {/* Progress bar */}
                <div className="w-full h-2.5 bg-gray-800 rounded-full overflow-hidden mb-2">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      data.enterprise_limits.consumed_pct > 90
                        ? 'bg-red-500'
                        : data.enterprise_limits.consumed_pct > 70
                        ? 'bg-yellow-500'
                        : 'bg-blue-500'
                    }`}
                    style={{ width: `${Math.min(100, data.enterprise_limits.consumed_pct)}%` }}
                  />
                </div>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed">
                Included AI credits consumed by users in your account. Monthly limit resets in{' '}
                <span className="text-blue-300 font-semibold">{data.report_period.days_until_reset} days</span> on{' '}
                <span className="text-gray-300 font-semibold">{data.report_period.reset_date_str}</span>.
              </p>
            </div>

            {/* Card 2: Additional Usage */}
            <div className="bg-gray-900/90 border border-gray-800 rounded-xl p-5 flex flex-col justify-between shadow-lg">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Additional Usage</p>
                  <span className="text-xs text-gray-500">Cap: $0.00</span>
                </div>
                <div className="text-3xl font-extrabold text-green-400 mb-2">
                  ${data.enterprise_limits.additional_usage_dollars.toFixed(2)}
                </div>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed">
                Spend on additional AI credits exceeding your included credits pool.
              </p>
            </div>

            {/* Card 3: Month-to-Date Spend */}
            <div className="bg-gray-900/90 border border-gray-800 rounded-xl p-5 flex flex-col justify-between shadow-lg">
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  Gross Value ({data.report_period.period_label})
                </p>
                <div className="text-3xl font-extrabold text-yellow-300 mb-2">
                  ${data.enterprise_limits.gross_spend_dollars.toFixed(2)}
                </div>
              </div>
              <p className="text-xs text-gray-400 leading-relaxed">
                Total AI consumption value this cycle across all users (calculated at $0.01 per AI credit).
              </p>
            </div>

            {/* Card 4: Active Seats & Environment */}
            <div className="bg-gray-900/90 border border-gray-800 rounded-xl p-5 flex flex-col justify-between shadow-lg">
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Enterprise Seats</p>
                <div className="flex items-baseline gap-2 mb-2">
                  <span className="text-3xl font-extrabold text-green-400">
                    {data.billing.seat_breakdown.active_this_cycle}
                  </span>
                  <span className="text-sm font-medium text-gray-400">
                    / {data.billing.seat_breakdown.total} active seats
                  </span>
                </div>
              </div>
              <div className="flex gap-1.5 flex-wrap text-xs">
                <span className="px-2 py-0.5 rounded bg-blue-950/60 text-blue-300 border border-blue-800/50">
                  IDE: {data.billing.ide_chat}
                </span>
                <span className="px-2 py-0.5 rounded bg-purple-950/60 text-purple-300 border border-purple-800/50">
                  Platform: {data.billing.platform_chat}
                </span>
                <span className="px-2 py-0.5 rounded bg-green-950/60 text-green-300 border border-green-800/50">
                  CLI: {data.billing.cli}
                </span>
              </div>
            </div>
          </div>

          {/* View Mode Navigation Tabs */}
          <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 mb-6 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider mr-1">Timeframe:</span>
                <button
                  onClick={() => setViewMode('mtd')}
                  className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                    viewMode === 'mtd'
                      ? 'bg-blue-600 text-white shadow'
                      : 'bg-gray-800/80 text-gray-400 hover:text-white hover:bg-gray-700'
                  }`}
                >
                  🗓️ Current Month ({data.report_period.period_label})
                </button>

                <button
                  onClick={() => setViewMode('daily')}
                  className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                    viewMode === 'daily'
                      ? 'bg-blue-600 text-white shadow'
                      : 'bg-gray-800/80 text-gray-400 hover:text-white hover:bg-gray-700'
                  }`}
                >
                  📅 Daily Breakdown
                </button>

                <button
                  onClick={() => setViewMode('rolling_28d')}
                  className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                    viewMode === 'rolling_28d'
                      ? 'bg-blue-600 text-white shadow'
                      : 'bg-gray-800/80 text-gray-400 hover:text-white hover:bg-gray-700'
                  }`}
                >
                  📊 28-Day Rolling Window
                </button>
              </div>

              {viewMode === 'daily' && data.report_period.available_days?.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">Select Day:</span>
                  <div className="flex gap-1.5">
                    {data.report_period.available_days.map((d) => (
                      <button
                        key={d}
                        onClick={() => setSelectedDay(d)}
                        className={`px-2.5 py-1 rounded text-xs font-mono font-medium transition-colors ${
                          selectedDay === d
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Daily History Trend Cards in Daily Mode */}
            {viewMode === 'daily' && data.daily_history?.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4 pt-4 border-t border-gray-800">
                {data.daily_history.map((dh) => (
                  <div
                    key={dh.date}
                    onClick={() => setSelectedDay(dh.date)}
                    className={`p-3 rounded-lg border cursor-pointer transition-all ${
                      selectedDay === dh.date
                        ? 'bg-blue-950/40 border-blue-600 shadow'
                        : 'bg-gray-950 border-gray-800/80 hover:border-gray-700'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                      <span className="font-mono font-semibold">{dh.date}</span>
                      <span>{dh.active_users} active users</span>
                    </div>
                    <div className="text-xl font-bold text-yellow-300">
                      {dh.credits.toLocaleString(undefined, { maximumFractionDigits: 1 })} credits
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">${dh.dollars.toFixed(2)} value</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Filter, Search, and Status Summary */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-3 flex-wrap">
              {/* Search */}
              <div className="relative w-64">
                <input
                  type="text"
                  placeholder="Filter by user, editor, phase…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="bg-gray-900 border border-gray-800 focus:border-blue-500 rounded-lg pl-8 pr-3 py-2 text-sm w-full focus:outline-none transition-colors"
                />
                <span className="absolute left-2.5 top-2.5 text-gray-500 text-xs">🔍</span>
              </div>

              {/* Status filter buttons */}
              <div className="flex gap-1.5 text-xs">
                <button
                  onClick={() => setStatusFilter('all')}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                    statusFilter === 'all'
                      ? 'bg-gray-700 text-white'
                      : 'bg-gray-900 border border-gray-800 text-gray-400 hover:text-white'
                  }`}
                >
                  All ({data.users.length})
                </button>
                <button
                  onClick={() => setStatusFilter('over_budget')}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                    statusFilter === 'over_budget'
                      ? 'bg-red-900/60 text-red-200 border border-red-700'
                      : 'bg-gray-900 border border-gray-800 text-red-400 hover:text-red-300'
                  }`}
                >
                  Over Budget ({overBudgetCount})
                </button>
                <button
                  onClick={() => setStatusFilter('under_budget')}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                    statusFilter === 'under_budget'
                      ? 'bg-green-900/60 text-green-200 border border-green-700'
                      : 'bg-gray-900 border border-gray-800 text-green-400 hover:text-green-300'
                  }`}
                >
                  Under Budget ({underBudgetCount})
                </button>
                <button
                  onClick={() => setStatusFilter('inactive')}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                    statusFilter === 'inactive'
                      ? 'bg-gray-700 text-gray-200'
                      : 'bg-gray-900 border border-gray-800 text-gray-500 hover:text-gray-400'
                  }`}
                >
                  Inactive ({inactiveCount})
                </button>
              </div>
            </div>

            <div className="text-xs text-gray-400">
              Showing <span className="font-bold text-white">{filteredUsers.length}</span> of {data.users.length} users
            </div>
          </div>

          {/* Usage Breakdown Table */}
          <div className="overflow-x-auto rounded-xl border border-gray-800 bg-gray-900/40 shadow-md">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900/90 select-none">
                  <th
                    onClick={() => handleSort('user')}
                    className="px-4 py-3 text-left text-xs font-semibold text-gray-400 hover:text-white cursor-pointer"
                  >
                    User {sortKey === 'user' ? (sortAsc ? '↑' : '↓') : ''}
                  </th>
                  <th
                    onClick={() => handleSort('credits')}
                    className="px-4 py-3 text-left text-xs font-semibold text-gray-400 hover:text-white cursor-pointer"
                  >
                    {viewMode === 'mtd'
                      ? 'Current Month Credits'
                      : viewMode === 'daily'
                      ? `Credits (${selectedDay || 'Day'})`
                      : '28-Day Credits'}{' '}
                    {sortKey === 'credits' ? (sortAsc ? '↑' : '↓') : ''}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400">Gross Value</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400">Additional Usage</th>
                  <th
                    onClick={() => handleSort('loc_suggested')}
                    className="px-4 py-3 text-left text-xs font-semibold text-gray-400 hover:text-white cursor-pointer"
                  >
                    Suggested / Accepted LOC {sortKey === 'loc_suggested' ? (sortAsc ? '↑' : '↓') : ''}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400">Accept Rate</th>
                  <th
                    onClick={() => handleSort('interactions')}
                    className="px-4 py-3 text-left text-xs font-semibold text-gray-400 hover:text-white cursor-pointer"
                  >
                    Interactions {sortKey === 'interactions' ? (sortAsc ? '↑' : '↓') : ''}
                  </th>
                  <th
                    onClick={() => handleSort('code_gen')}
                    className="px-4 py-3 text-left text-xs font-semibold text-gray-400 hover:text-white cursor-pointer"
                  >
                    Code Gen {sortKey === 'code_gen' ? (sortAsc ? '↑' : '↓') : ''}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400">Phase</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400">Last Active</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400">Editor</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u, i) => {
                  const creditsDisplay =
                    viewMode === 'mtd'
                      ? u.credits_mtd
                      : viewMode === 'daily'
                      ? u.daily_credits[selectedDay] || 0
                      : u.credits_28d;

                  const dollarsDisplay = creditsDisplay / (data.credits_per_dollar || 100);
                  const locSug = viewMode === 'rolling_28d' ? u.loc_suggested_28d : u.loc_suggested_mtd;
                  const locAcc = viewMode === 'rolling_28d' ? u.loc_accepted_28d : u.loc_accepted_mtd;
                  const interactions = viewMode === 'rolling_28d' ? u.interactions_28d : u.interactions_mtd;
                  const codeGen = viewMode === 'rolling_28d' ? u.code_generations_28d : u.code_generations_mtd;

                  const isOverBudget = viewMode === 'mtd' && u.over_budget;
                  const budgetCap = data.budget_per_user || 3500;

                  return (
                    <tr
                      key={u.user_login}
                      className={`border-b border-gray-800/40 hover:bg-gray-900/60 transition-colors ${
                        i % 2 === 0 ? 'bg-gray-950/60' : 'bg-gray-900/20'
                      }`}
                    >
                      {/* User */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2.5">
                          {u.avatar_url ? (
                            <img src={u.avatar_url} alt="" className="w-7 h-7 rounded-full ring-1 ring-gray-700" />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-gray-800 flex items-center justify-center text-xs font-bold text-gray-300">
                              {u.user_login[0].toUpperCase()}
                            </div>
                          )}
                          <div>
                            <a
                              href={`https://github.com/${u.user_login}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:text-blue-300 font-semibold"
                            >
                              {u.user_login}
                            </a>
                            {u.pending_cancellation && (
                              <span className="ml-1.5 text-[10px] bg-red-950 text-red-400 border border-red-800 px-1 rounded">
                                cancelling
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* AI Credits */}
                      <td className="px-4 py-3.5 min-w-[200px]">
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={`font-mono font-bold text-sm ${
                              isOverBudget
                                ? 'text-red-400'
                                : u.credits_pct > 80
                                ? 'text-yellow-400'
                                : 'text-gray-100'
                            }`}
                          >
                            {creditsDisplay.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </span>
                          {viewMode === 'mtd' && (
                            <span className="text-xs text-gray-500 font-mono">
                              / {u.included_credits.toLocaleString()}
                            </span>
                          )}
                          {isOverBudget && (
                            <span className="text-[10px] font-bold bg-red-950 text-red-400 border border-red-800 px-1.5 py-0.2 rounded">
                              OVER
                            </span>
                          )}
                        </div>

                        {/* Progress Bar in MTD Mode */}
                        {viewMode === 'mtd' && (
                          <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                isOverBudget
                                  ? 'bg-red-500'
                                  : u.credits_pct > 80
                                  ? 'bg-yellow-500'
                                  : 'bg-green-500'
                              }`}
                              style={{ width: `${Math.min(100, (u.credits_mtd / 3500) * 100)}%` }}
                            />
                          </div>
                        )}
                      </td>

                      {/* Gross Amount */}
                      <td className="px-4 py-3.5 font-mono text-yellow-300 font-medium">
                        ${dollarsDisplay.toFixed(2)}
                      </td>

                      {/* Additional Usage */}
                      <td className="px-4 py-3.5 font-mono text-gray-400">
                        {isOverBudget ? (
                          <span className="text-red-400 font-medium">+${u.overage_dollars.toFixed(2)}</span>
                        ) : (
                          <span>$0.00</span>
                        )}
                      </td>

                      {/* Lines Suggested / Accepted */}
                      <td className="px-4 py-3.5 font-mono text-xs">
                        <span className="text-blue-300">{fmt(locSug)}</span>
                        <span className="text-gray-600 mx-1">/</span>
                        <span className="text-green-300">{fmt(locAcc)}</span>
                      </td>

                      {/* Accept Rate */}
                      <td className="px-4 py-3.5 text-xs text-gray-300 font-mono">
                        {acceptanceRate(locAcc, locSug)}
                      </td>

                      {/* Interactions */}
                      <td className="px-4 py-3.5 font-mono text-purple-300 text-xs">
                        {interactions > 0 ? fmt(interactions) : <span className="text-gray-600">0</span>}
                      </td>

                      {/* Code Gen */}
                      <td className="px-4 py-3.5 font-mono text-gray-300 text-xs">
                        {codeGen > 0 ? fmt(codeGen) : <span className="text-gray-600">0</span>}
                      </td>

                      {/* Phase */}
                      <td className="px-4 py-3.5">
                        {u.ai_adoption_phase ? (
                          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${phaseColor(u.ai_adoption_phase)}`}>
                            {u.ai_adoption_phase}
                          </span>
                        ) : (
                          <span className="text-gray-600 text-xs">—</span>
                        )}
                      </td>

                      {/* Last Active */}
                      <td className="px-4 py-3.5 text-xs text-gray-400 whitespace-nowrap">
                        {timeAgo(u.last_activity_at)}
                      </td>

                      {/* Editor */}
                      <td className="px-4 py-3.5 text-xs text-gray-400 whitespace-nowrap">
                        {editorLabel(u.last_activity_editor)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Footer explanation */}
          <div className="mt-6 p-4 rounded-xl bg-gray-900/40 border border-gray-800 text-xs text-gray-400 space-y-1.5">
            <p className="font-semibold text-gray-300 flex items-center gap-1.5">
              <span>ℹ️</span> GitHub Copilot Enterprise Metrics & Credit Calculation Guide
            </p>
            <p>
              • <strong>Monthly Cycle ({data.report_period.period_label}):</strong> Aggregated from daily metric reports starting on the 1st of the month. Monthly limit of 3,500 credits/seat resets on{' '}
              <span className="text-gray-200 font-semibold">{data.report_period.reset_date_str}</span>.
            </p>
            <p>
              • <strong>Daily Update Schedule:</strong> GitHub processes Copilot telemetry once per day (typically ~24h delay). The latest available metric day is{' '}
              <span className="text-blue-300 font-semibold">{data.report_period.daily_date || 'N/A'}</span>.
            </p>
            <p>
              • <strong>Pricing:</strong> Each AI credit costs $0.01 ($35.00 included budget per user/month).
            </p>
          </div>
        </>
      )}
    </div>
  );
}
