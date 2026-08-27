'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Deployment {
  id: string;
  environment: string;
  status: string;
  deployment_type?: string;
  branch?: string;
  version?: string;
  requested_by?: string;
  approved_by?: string;
  tested_by?: string;
  deployed_by?: string;
  ticket_link?: string;
  notes?: string;
  started_at: string;
  completed_at?: string;
  duration_seconds?: number;
}

interface Environment {
  id: string;
  name: string;
  is_production: boolean;
  display_order: number;
}

interface EnvHealth {
  environment: string;
  status: string | null;
  branch: string | null;
  version: string | null;
  deployed_by: string | null;
  last_deployed_at: string | null;
  is_production: boolean;
}

export default function Home() {
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [envHealth, setEnvHealth] = useState<EnvHealth[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filters
  const [filterEnv, setFilterEnv] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const [deploymentsRes, environmentsRes, healthRes] = await Promise.all([
        fetch('/api/deployments'),
        fetch('/api/environments'),
        fetch('/api/health'),
      ]);
      
      const deploymentsData = await deploymentsRes.json();
      const environmentsData = await environmentsRes.json();
      const healthData = await healthRes.json();
      
      if (Array.isArray(deploymentsData)) setDeployments(deploymentsData);
      if (Array.isArray(environmentsData)) setEnvironments(environmentsData);
      if (Array.isArray(healthData)) setEnvHealth(healthData);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'Success': return 'success';
      case 'In Progress': return 'progress';
      case 'Failed': return 'failed';
      case 'Rolled Back': return 'rollback';
      case 'Cancelled': return 'cancelled';
      default: return 'none';
    }
  };

  const getTypeColor = (type: string | undefined) => {
    switch (type) {
      case 'rollback': return 'bg-[rgba(138,147,168,0.12)] text-[#8A93A8]';
      case 'hotfix': return 'bg-[rgba(245,166,35,0.12)] text-[#F5A623]';
      default: return 'bg-[rgba(91,141,239,0.08)] text-[#5B8DEF]';
    }
  };

  const timeAgo = (isoDate: string) => {
    const diff = (Date.now() - new Date(isoDate).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  const formatDuration = (seconds: number | undefined) => {
    if (!seconds) return '—';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  // Filter deployments
  const filteredDeployments = deployments.filter(d => {
    if (filterEnv && d.environment !== filterEnv) return false;
    if (filterStatus && d.status !== filterStatus) return false;
    if (filterDate && !d.started_at.startsWith(filterDate)) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return [d.branch, d.version, d.ticket_link, d.requested_by, d.deployed_by, d.notes]
        .some(field => field?.toLowerCase().includes(q));
    }
    return true;
  });

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">
      <div className="text-xl" style={{color: 'var(--muted)'}}>Loading...</div>
    </div>;
  }

  return (
    <div className="min-h-screen" style={{padding: '32px clamp(16px, 2vw, 24px) 80px'}}>
      {/* Header */}
      <header className="flex justify-between items-end flex-wrap gap-4 mb-7">
        <div>
          <h1 className="text-[28px] font-bold m-0 mb-1" style={{fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '-0.02em'}}>
            Deployment Tracker
          </h1>
          <div className="text-sm" style={{color: 'var(--muted)'}}>
            <span style={{color: 'var(--ok)'}}>●</span> Live status across QA, Stage, Preview, Pre-Prod, Pre-Prod USW & Production
          </div>
        </div>
        <div className="flex gap-3 flex-wrap">
          <Link href="/health" className="btn-ghost">
            Environment Health
          </Link>
          <button className="btn-primary">+ New Deployment</button>
        </div>
      </header>

      {/* Environment Cards */}
      <div className="grid gap-[14px] mb-8" style={{gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))'}}>
        {envHealth.map((env) => {
          const daysSince = env.last_deployed_at 
            ? Math.floor((Date.now() - new Date(env.last_deployed_at).getTime()) / (1000 * 60 * 60 * 24))
            : null;
          
          return (
            <div key={env.environment} className={`card ${env.is_production ? 'is-prod' : ''}`}>
              <div className="stripe" style={{background: env.is_production ? 'var(--prod)' : 'var(--accent)'}} />
              <div className="env-name">
                {env.environment}
                {env.is_production && <span className="prod-tag">LIVE</span>}
              </div>
              {env.status ? (
                <>
                  <span className={`badge ${getStatusClass(env.status)}`}>
                    <span className="b-dot" />
                    {env.status}
                  </span>
                  <div className="meta">
                    <b>{env.last_deployed_at ? new Date(env.last_deployed_at).toLocaleString() : '—'}</b>
                    {daysSince !== null && ` · ${daysSince === 0 ? 'today' : `${daysSince}d ago`}`}
                    <br />
                    by {env.deployed_by || '—'}
                    {env.branch && <div className="branch">{env.branch}</div>}
                  </div>
                </>
              ) : (
                <span className="badge none">
                  <span className="b-dot" />
                  No deploys yet
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="filter-row">
        <select value={filterEnv} onChange={(e) => setFilterEnv(e.target.value)} className="filter-select">
          <option value="">All Environments</option>
          {environments.map((env) => (
            <option key={env.id} value={env.name}>{env.name}</option>
          ))}
        </select>
        
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="filter-select">
          <option value="">All Statuses</option>
          <option value="Success">Success</option>
          <option value="In Progress">In Progress</option>
          <option value="Failed">Failed</option>
          <option value="Cancelled">Cancelled</option>
          <option value="Rolled Back">Rolled Back</option>
        </select>

        <input
          type="date"
          value={filterDate}
          onChange={(e) => setFilterDate(e.target.value)}
          className="filter-select"
          style={{colorScheme: 'dark'}}
        />
        
        {filterDate && (
          <button onClick={() => setFilterDate('')} className="btn-ghost-small">
            ✕ Clear date
          </button>
        )}

        <div className="flex-1" style={{minWidth: '240px'}}>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search branch, version, ticket, or names…"
            className="filter-select w-full"
          />
        </div>

        <div className="text-xs" style={{color: 'var(--faint)', marginLeft: 'auto'}}>
          {filteredDeployments.length} {filteredDeployments.length === 1 ? 'entry' : 'entries'}
        </div>
      </div>

      {/* Table */}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Environment</th>
              <th>Status</th>
              <th>Type</th>
              <th>Branch / Version</th>
              <th>Duration</th>
              <th>Requested By</th>
              <th>Deployed By</th>
              <th>Started At</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {filteredDeployments.length === 0 ? (
              <tr>
                <td colSpan={9} className="empty-state">
                  <div className="big">No deployments found</div>
                  <div style={{color: 'var(--faint)', fontSize: '13px', marginTop: '4px'}}>
                    {searchQuery || filterEnv || filterStatus || filterDate
                      ? 'Try adjusting your filters'
                      : 'Click "+ New Deployment" to add the first entry'}
                  </div>
                </td>
              </tr>
            ) : (
              filteredDeployments.map((d) => (
                <tr key={d.id}>
                  <td className="env-cell">{d.environment}</td>
                  <td>
                    <span className={`badge ${getStatusClass(d.status)}`}>
                      <span className="b-dot" />
                      {d.status}
                    </span>
                  </td>
                  <td>
                    {d.deployment_type && (
                      <span className={`type-badge ${getTypeColor(d.deployment_type)}`}>
                        {d.deployment_type}
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="mono">{d.branch || '—'}</div>
                    {d.version && (
                      <div style={{color: 'var(--muted)', fontSize: '11.5px', marginTop: '2px'}}>
                        {d.version.slice(0, 12)}
                      </div>
                    )}
                  </td>
                  <td style={{color: 'var(--muted)', fontSize: '12.5px'}}>
                    {formatDuration(d.duration_seconds)}
                  </td>
                  <td className="who">{d.requested_by || '—'}</td>
                  <td className="who">{d.deployed_by || '—'}</td>
                  <td style={{color: 'var(--muted)', fontSize: '12.5px'}}>
                    {new Date(d.started_at).toLocaleString()}
                    <div style={{color: 'var(--faint)', fontSize: '11px', marginTop: '2px'}}>
                      {timeAgo(d.started_at)}
                    </div>
                  </td>
                  <td className="notes">
                    {d.ticket_link && (
                      <div className="mono" style={{color: 'var(--muted)', marginBottom: '4px'}}>
                        {d.ticket_link}
                      </div>
                    )}
                    {d.notes && <div>{d.notes}</div>}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <footer className="mt-7 text-center text-[11.5px]" style={{color: 'var(--faint)', lineHeight: '1.6'}}>
        Auto-refreshing every 5 seconds • Last updated: {new Date().toLocaleTimeString()}
      </footer>

      <style jsx>{`
        .btn-ghost, .btn-primary, .btn-ghost-small {
          font-family: inherit;
          cursor: pointer;
          padding: 10px 16px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          transition: 0.15s;
          text-decoration: none;
        }
        .btn-ghost {
          background: var(--panel-2);
          border: 1px solid var(--border);
          color: var(--text);
        }
        .btn-ghost:hover {
          border-color: var(--accent);
          color: #fff;
        }
        .btn-ghost-small {
          padding: 6px 10px;
          font-size: 12px;
          background: transparent;
          border: 1px solid var(--border);
          color: var(--text);
        }
        .btn-ghost-small:hover {
          border-color: var(--accent);
        }
        .btn-primary {
          background: var(--accent);
          border: 1px solid var(--accent);
          color: #0B0E14;
        }
        .btn-primary:hover {
          background: #7AA3F5;
        }
        .card {
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 16px;
          position: relative;
          overflow: hidden;
          min-height: 132px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }
        .card.is-prod {
          border-color: rgba(245, 166, 35, 0.35);
        }
        .stripe {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
        }
        .env-name {
          font-family: 'Space Grotesk', sans-serif;
          font-weight: 600;
          font-size: 15px;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .prod-tag {
          font-size: 9px;
          background: var(--prod);
          color: #1a1300;
          padding: 2px 6px;
          border-radius: 4px;
          font-weight: 700;
          letter-spacing: 0.04em;
        }
        .badge {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 3px 9px;
          border-radius: 100px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.02em;
          width: fit-content;
        }
        .b-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }
        .badge.success { background: var(--ok-bg); color: var(--ok); }
        .badge.success .b-dot { background: var(--ok); }
        .badge.progress { background: var(--warn-bg); color: var(--warn); }
        .badge.progress .b-dot { background: var(--warn); animation: pulse 1.4s infinite; }
        .badge.failed { background: var(--bad-bg); color: var(--bad); }
        .badge.failed .b-dot { background: var(--bad); }
        .badge.rollback { background: var(--neutral-bg); color: var(--neutral); }
        .badge.rollback .b-dot { background: var(--neutral); }
        .badge.cancelled { background: rgba(138, 147, 168, 0.14); color: #B7BECC; }
        .badge.cancelled .b-dot { background: #B7BECC; }
        .badge.none { background: rgba(255, 255, 255, 0.04); color: var(--faint); }
        .badge.none .b-dot { background: var(--faint); }
        .meta {
          font-size: 12px;
          color: var(--muted);
          line-height: 1.6;
        }
        .meta b {
          color: var(--text);
          font-weight: 500;
        }
        .branch {
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          color: var(--accent);
          background: rgba(91, 141, 239, 0.08);
          padding: 2px 6px;
          border-radius: 4px;
          display: inline-block;
          margin-top: 4px;
        }
        .filter-row {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          align-items: center;
          margin-bottom: 16px;
        }
        .filter-select {
          background: var(--panel-2);
          border: 1px solid var(--border);
          color: var(--text);
          padding: 9px 12px;
          border-radius: 8px;
          font-size: 13px;
          font-family: inherit;
        }
        .filter-select:focus {
          outline: none;
          border-color: var(--accent);
        }
        .table-wrap {
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: 12px;
          overflow-x: auto;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
          min-width: 1100px;
        }
        thead th {
          text-align: left;
          padding: 12px 14px;
          background: var(--panel-2);
          color: var(--muted);
          font-weight: 600;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border-bottom: 1px solid var(--border);
          white-space: nowrap;
        }
        tbody td {
          padding: 13px 14px;
          border-bottom: 1px solid var(--border);
          vertical-align: top;
        }
        tbody tr:last-child td {
          border-bottom: none;
        }
        tbody tr:hover {
          background: rgba(255, 255, 255, 0.015);
        }
        .env-cell {
          font-weight: 600;
        }
        .mono {
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: var(--accent);
        }
        .who {
          color: var(--muted);
          font-size: 12.5px;
        }
        .notes {
          color: var(--muted);
          max-width: 220px;
          font-size: 12.5px;
        }
        .empty-state {
          padding: 60px 20px;
          text-align: center;
          color: var(--faint);
        }
        .empty-state .big {
          font-size: 15px;
          color: var(--muted);
          margin-bottom: 6px;
        }
        .type-badge {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 600;
        }
      `}</style>
    </div>
  );
}
