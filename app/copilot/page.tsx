'use client';

import { useState, useEffect, useCallback } from 'react';

interface UserSummary {
  user_login: string;
  user_id: number;
  avatar_url?: string;
  // From API row
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
  last_activity_at?: string;
  last_activity_editor?: string;
  last_authenticated_at?: string;
  plan_type?: string;
  pending_cancellation?: boolean;
  // Budget fields (computed from route)
  included_credits: number;
  credits_used: number;
  credits_remaining: number;
  credits_pct: number; // 0-100
  over_budget: boolean;
  dollars_used: number;
  dollars_remaining: number;
  budget_pct: number; // 0-100
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

interface OrgTotals {
  ai_credits_used: number;
  loc_suggested: number;
  loc_accepted: number;
  interactions: number;
  code_generations: number;
  dollars: number;
}

interface CopilotData {
  report_period: { start: string; end: string };
  billing: Billing;
  org_totals: OrgTotals;
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
  if (phase.includes('1')) return 'bg-red-900/50 text-red-300';
  if (phase.includes('2')) return 'bg-yellow-900/50 text-yellow-300';
  if (phase.includes('3')) return 'bg-blue-900/50 text-blue-300';
  if (phase.includes('4')) return 'bg-green-900/50 text-green-300';
  return 'bg-gray-700 text-gray-300';
}

type SortKey = keyof UserSummary;

export default function CopilotPage() {
  const [data, setData] = useState<CopilotData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('ai_credits_used');
  const [sortAsc, setSortAsc] = useState(false);
  const [search, setSearch] = useState('');
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/copilot');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fetch');
      setData(json);
      setLastFetched(new Date());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  }

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey === k ? (sortAsc ? ' ↑' : ' ↓') : '';

  const users = data?.users
    .filter(u => u.user_login.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const av = a[sortKey] as any;
      const bv = b[sortKey] as any;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sortAsc ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    }) ?? [];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <a href="/" className="text-gray-400 hover:text-white text-sm">← Deployments</a>
          <span className="text-gray-600">/</span>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <span>🤖</span> GitHub Copilot Usage
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {lastFetched && (
            <span className="text-xs text-gray-500">
              Updated {timeAgo(lastFetched.toISOString())}
            </span>
          )}
          <button
            onClick={fetchData}
            disabled={loading}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-sm font-medium"
          >
            {loading ? 'Loading…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded p-4 mb-6 text-red-300">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center h-64 text-gray-400">
          Loading Copilot usage data…
        </div>
      )}

      {data && (
        <>
          {/* Report period */}
          <p className="text-xs text-gray-500 mb-4">
            Report period: {data.report_period.start} → {data.report_period.end} &nbsp;·&nbsp;
            Plan: <span className="text-purple-400 capitalize">{data.billing.plan_type}</span> &nbsp;·&nbsp;
            Org: <span className="text-blue-400">vidaisolutions</span>
          </p>

          {/* Top stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
            {[
              { label: 'Total Seats', value: data.billing.seat_breakdown.total, color: 'text-white' },
              { label: 'Active', value: data.billing.seat_breakdown.active_this_cycle, color: 'text-green-400' },
              { label: 'Inactive', value: data.billing.seat_breakdown.inactive_this_cycle, color: 'text-red-400' },
              { label: 'Org Credits', value: fmt(data.org_totals.ai_credits_used, 1), color: 'text-yellow-400' },
              { label: 'Org Spend', value: '$' + fmt(data.org_totals.dollars, 2), color: 'text-yellow-300' },
              { label: 'Interactions', value: fmt(data.org_totals.interactions), color: 'text-purple-400' },
              { label: 'Code Gen', value: fmt(data.org_totals.code_generations), color: 'text-gray-300' },
            ].map(card => (
              <div key={card.label} className="bg-gray-900 border border-gray-800 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-1">{card.label}</p>
                <p className={`text-xl font-bold ${card.color}`}>{card.value}</p>
              </div>
            ))}
          </div>

          {/* Features enabled */}
          <div className="flex gap-2 mb-6 flex-wrap">
            {[
              { label: 'IDE Chat', val: data.billing.ide_chat },
              { label: 'Platform Chat', val: data.billing.platform_chat },
              { label: 'CLI', val: data.billing.cli },
            ].map(f => (
              <span
                key={f.label}
                className={`px-2 py-1 rounded text-xs font-medium border ${
                  f.val === 'enabled'
                    ? 'bg-green-900/30 text-green-400 border-green-800'
                    : 'bg-gray-800 text-gray-500 border-gray-700'
                }`}
              >
                {f.label}: {f.val}
              </span>
            ))}
          </div>

          {/* Search */}
          <div className="mb-4">
            <input
              type="text"
              placeholder="Search users…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm w-64 focus:outline-none focus:border-blue-500"
            />
            <span className="text-xs text-gray-500 ml-3">{users.length} users</span>
          </div>

          {/* Per-user table */}
          <div className="overflow-x-auto rounded-lg border border-gray-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900/80">
                  {[
                    { key: 'user_login', label: 'User' },
                    { key: 'ai_credits_used', label: 'AI Credits' },
                    { key: 'loc_suggested', label: 'Lines Suggested' },
                    { key: 'loc_accepted', label: 'Lines Accepted' },
                    { key: null, label: 'Accept Rate' },
                    { key: 'interactions', label: 'Interactions' },
                    { key: 'code_generations', label: 'Code Gen' },
                    { key: 'active_days', label: 'Active Days' },
                    { key: null, label: 'Features' },
                    { key: 'ai_adoption_phase', label: 'Phase' },
                    { key: 'last_activity_at', label: 'Last Active' },
                    { key: null, label: 'Editor' },
                  ].map(col => (
                    <th
                      key={col.label}
                      onClick={() => col.key && handleSort(col.key as SortKey)}
                      className={`px-3 py-3 text-left text-xs font-medium text-gray-400 whitespace-nowrap ${
                        col.key ? 'cursor-pointer hover:text-white select-none' : ''
                      }`}
                    >
                      {col.label}
                      {col.key && <SortIcon k={col.key as SortKey} />}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((u, i) => {
                  const isActive = (u.ai_credits_used > 0 || u.code_generations > 0);
                  return (
                    <tr
                      key={u.user_login}
                      className={`border-b border-gray-800/50 hover:bg-gray-900/50 transition-colors ${
                        i % 2 === 0 ? 'bg-gray-950' : 'bg-gray-900/20'
                      }`}
                    >
                      {/* User */}
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          {u.avatar_url ? (
                            <img src={u.avatar_url} alt="" className="w-6 h-6 rounded-full" />
                          ) : (
                            <div className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-xs">
                              {u.user_login[0].toUpperCase()}
                            </div>
                          )}
                          <a
                            href={`https://github.com/${u.user_login}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:underline font-medium"
                          >
                            {u.user_login}
                          </a>
                          {u.pending_cancellation && (
                            <span className="text-xs bg-red-900/40 text-red-400 px-1 rounded">cancelling</span>
                          )}
                          {!isActive && (
                            <span className="text-xs bg-gray-800 text-gray-500 px-1 rounded">inactive</span>
                          )}
                        </div>
                      </td>
                      {/* AI Credits */}
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 min-w-[80px]">
                            <div className="flex justify-between text-xs mb-0.5">
                              <span className={`font-mono font-bold ${u.over_budget ? 'text-red-400' : u.credits_pct > 80 ? 'text-yellow-400' : 'text-yellow-300'}`}>
                                {u.credits_used.toLocaleString()}
                              </span>
                              <span className="text-gray-500">/ {u.included_credits.toLocaleString()}</span>
                            </div>
                            <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${
                                  u.over_budget ? 'bg-red-500'
                                  : u.credits_pct > 80 ? 'bg-yellow-500'
                                  : 'bg-green-500'
                                }`}
                                style={{ width: `${Math.min(100, u.credits_pct)}%` }}
                              />
                            </div>
                          </div>
                          {u.over_budget && (
                            <span className="text-xs bg-red-900/40 text-red-400 px-1 rounded whitespace-nowrap">OVER</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          ${u.dollars_used.toFixed(2)} / ${u.dollars_remaining.toFixed(2)} remaining
                        </div>
                      </td>
                      {/* Lines Suggested */}
                      <td className="px-3 py-3 font-mono text-blue-300">
                        {u.loc_suggested > 0 ? fmt(u.loc_suggested) : <span className="text-gray-600">0</span>}
                      </td>
                      {/* Lines Accepted */}
                      <td className="px-3 py-3 font-mono text-green-300">
                        {u.loc_accepted > 0 ? fmt(u.loc_accepted) : <span className="text-gray-600">0</span>}
                      </td>
                      {/* Accept Rate */}
                      <td className="px-3 py-3 text-gray-300">
                        {acceptanceRate(u.loc_accepted, u.loc_suggested)}
                      </td>
                      {/* Interactions */}
                      <td className="px-3 py-3 font-mono text-purple-300">
                        {u.interactions > 0 ? fmt(u.interactions) : <span className="text-gray-600">0</span>}
                      </td>
                      {/* Code Gen */}
                      <td className="px-3 py-3 font-mono text-gray-300">
                        {u.code_generations > 0 ? fmt(u.code_generations) : <span className="text-gray-600">0</span>}
                      </td>
                      {/* Active Days */}
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1">
                          <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-500 rounded-full"
                              style={{ width: `${Math.min(100, (u.active_days / 28) * 100)}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-400">{u.active_days}</span>
                        </div>
                      </td>
                      {/* Features */}
                      <td className="px-3 py-3">
                        <div className="flex gap-1">
                          {u.used_chat && (
                            <span className="text-xs bg-purple-900/40 text-purple-300 px-1.5 py-0.5 rounded">Chat</span>
                          )}
                          {u.used_agent && (
                            <span className="text-xs bg-blue-900/40 text-blue-300 px-1.5 py-0.5 rounded">Agent</span>
                          )}
                          {!u.used_chat && !u.used_agent && (
                            <span className="text-xs text-gray-600">—</span>
                          )}
                        </div>
                      </td>
                      {/* Phase */}
                      <td className="px-3 py-3">
                        {u.ai_adoption_phase ? (
                          <span className={`text-xs px-1.5 py-0.5 rounded ${phaseColor(u.ai_adoption_phase)}`}>
                            {u.ai_adoption_phase}
                          </span>
                        ) : <span className="text-gray-600">—</span>}
                      </td>
                      {/* Last Active */}
                      <td className="px-3 py-3 text-xs text-gray-400 whitespace-nowrap">
                        {timeAgo(u.last_activity_at)}
                      </td>
                      {/* Editor */}
                      <td className="px-3 py-3 text-xs text-gray-400">
                        {editorLabel(u.last_activity_editor)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Footer note */}
          <p className="text-xs text-gray-600 mt-4">
            GitHub Copilot Enterprise · {data.billing.plan_type} · {data.budget_per_user.toLocaleString()} credits/user/month (${data.budget_per_user.toFixed(2)}) ·
            Data from GitHub Copilot Metrics API · 28-day rolling window ending {data.report_period.end} ·
            Cached 5 min server-side
          </p>
        </>
      )}
    </div>
  );
}
