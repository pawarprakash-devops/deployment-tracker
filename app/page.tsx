'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface Deployment {
  id: string;
  environment: string;
  status: string;
  branch?: string;
  version?: string;
  frontend_branch?: string;
  backend_branch?: string;
  frontend_version?: string;
  backend_version?: string;
  requested_by?: string;
  approved_by?: string;
  tested_by?: string;
  deployed_by?: string;
  ticket_link?: string;
  notes?: string;
  started_at: string;
  completed_at?: string;
  duration_seconds?: number;
  duration?: string;
}

interface Environment {
  name: string;
  color: string;
  isProd: boolean;
  description?: string;
}

export default function Home() {
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginPassword, setLoginPassword] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  
  // Comparison
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [showCompareModal, setShowCompareModal] = useState(false);
  
  // Modal states
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [showEnvModal, setShowEnvModal] = useState(false);
  const [editingDeployId, setEditingDeployId] = useState<string | null>(null);
  
  // Filter states
  const [filterEnv, setFilterEnv] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Form states
  const [deployForm, setDeployForm] = useState({
    environment: '',
    status: 'Success',
    branch: '',
    version: '',
    datetime: '',
    duration: '',
    requested_by: '',
    approved_by: '',
    tested_by: '',
    deployed_by: '',
    ticket_link: '',
    notes: ''
  });

  const [newEnvForm, setNewEnvForm] = useState({
    name: '',
    color: '#5B8DEF',
    isProd: false,
    description: ''
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load theme from localStorage
  useEffect(() => {
    const savedTheme = localStorage.getItem('tracker-theme') as 'dark' | 'light' | null;
    if (savedTheme) setTheme(savedTheme);
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    localStorage.setItem('tracker-theme', newTheme);
  };

  useEffect(() => {
    loadData();
    checkAuth();
    const interval = setInterval(() => {
      loadData();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/auth/session');
      const data = await res.json();
      setIsAdmin(data.authenticated);
    } catch (error) {
      setIsAdmin(false);
    }
  };

  const handleLogin = async () => {
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: loginPassword })
      });
      if (res.ok) {
        setIsAdmin(true);
        setShowLoginModal(false);
        setLoginPassword('');
      } else {
        alert('Invalid password');
      }
    } catch (error) {
      alert('Login failed');
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth', { method: 'DELETE' });
      setIsAdmin(false);
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const loadData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [deploymentsRes, environmentsRes] = await Promise.all([
        fetch('/api/deployments?limit=1000'),
        fetch('/api/environments'),
      ]);
      if (deploymentsRes.ok) {
        const data = await deploymentsRes.json();
        setDeployments(Array.isArray(data) ? data : []);
      }
      if (environmentsRes.ok) {
        const envData = await environmentsRes.json();
        if (Array.isArray(envData)) {
          setEnvironments(envData.map(e => ({
            name: e.name,
            color: '#5B8DEF',
            isProd: e.is_production || false,
            description: ''
          })));
        }
      }
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
      setTimeout(() => setIsRefreshing(false), 300);
    }
  }, []);

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

  const timeAgo = (isoDate: string) => {
    const diff = (Date.now() - new Date(isoDate).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  };

  const latestForEnv = (envName: string) => {
    return deployments
      .filter(d => d.environment === envName)
      .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())[0];
  };

  const latestBranchesForEnv = (envName: string) => {
    const envDeployments = deployments
      .filter(d => d.environment === envName && d.status === 'Success')
      .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
    let latestFE: string | null = null;
    let latestBE: string | null = null;
    for (const d of envDeployments) {
      if (!latestFE && d.frontend_branch) latestFE = d.frontend_branch;
      if (!latestBE && d.backend_branch) latestBE = d.backend_branch;
      if (latestFE && latestBE) break;
    }
    return { fe: latestFE, be: latestBE };
  };

  // Environment health status
  const getEnvHealth = (envName: string) => {
    const envDeps = deployments
      .filter(d => d.environment === envName)
      .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
    
    if (envDeps.length === 0) return { status: 'empty', label: 'No deploys', color: 'var(--faint)' };
    
    const latest = envDeps[0];
    const daysSinceDeploy = (Date.now() - new Date(latest.started_at).getTime()) / (1000 * 60 * 60 * 24);
    
    // Check consecutive failures
    let consecutiveFailures = 0;
    for (const d of envDeps) {
      if (d.status === 'Failed') consecutiveFailures++;
      else break;
    }
    
    if (consecutiveFailures >= 3) return { status: 'critical', label: `${consecutiveFailures} consecutive failures`, color: 'var(--bad)' };
    if (consecutiveFailures >= 2) return { status: 'warning', label: `${consecutiveFailures} consecutive failures`, color: 'var(--warn)' };
    if (daysSinceDeploy > 30) return { status: 'stale', label: `Stale (${Math.floor(daysSinceDeploy)}d ago)`, color: 'var(--warn)' };
    if (daysSinceDeploy > 14) return { status: 'aging', label: `Aging (${Math.floor(daysSinceDeploy)}d ago)`, color: 'var(--faint)' };
    
    return { status: 'healthy', label: '', color: 'var(--ok)' };
  };

  // Last deploy times for FE and BE
  const getLastDeployTimes = (envName: string) => {
    const envDeps = deployments
      .filter(d => d.environment === envName && d.status === 'Success')
      .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
    
    let lastFE: string | null = null;
    let lastBE: string | null = null;
    
    for (const d of envDeps) {
      if (!lastFE && d.frontend_branch) lastFE = d.started_at;
      if (!lastBE && d.backend_branch) lastBE = d.started_at;
      if (lastFE && lastBE) break;
    }
    
    return { feAgo: lastFE ? timeAgo(lastFE) : null, beAgo: lastBE ? timeAgo(lastBE) : null };
  };

  // Timeline data for last 14 days
  const getTimelineData = () => {
    const days: { date: string; label: string; envData: Record<string, { success: number; failed: number; other: number }> }[] = [];
    
    for (let i = 13; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const label = date.toLocaleDateString('en', { month: 'short', day: 'numeric' });
      
      const envData: Record<string, { success: number; failed: number; other: number }> = {};
      environments.forEach(env => {
        const dayDeps = deployments.filter(d => 
          d.environment === env.name && d.started_at.startsWith(dateStr)
        );
        envData[env.name] = {
          success: dayDeps.filter(d => d.status === 'Success').length,
          failed: dayDeps.filter(d => d.status === 'Failed').length,
          other: dayDeps.filter(d => d.status !== 'Success' && d.status !== 'Failed').length,
        };
      });
      
      days.push({ date: dateStr, label, envData });
    }
    
    return days;
  };

  // Ticket link formatter
  const formatTicketLink = (link: string) => {
    if (!link) return null;
    
    const ghMatch = link.match(/github\.com\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)/);
    if (ghMatch) {
      return { text: `#${ghMatch[3].slice(-6)}`, fullText: `${ghMatch[1]}/${ghMatch[2]} Run #...${ghMatch[3].slice(-6)}`, url: link };
    }
    
    const jiraMatch = link.match(/((?:[A-Z]+-\d+))/);
    if (jiraMatch) {
      return { text: jiraMatch[1], fullText: jiraMatch[1], url: link };
    }
    
    try {
      const url = new URL(link);
      return { text: url.pathname.split('/').pop() || url.hostname, fullText: url.hostname + url.pathname, url: link };
    } catch {
      return { text: link.length > 30 ? link.slice(0, 30) + '...' : link, fullText: link, url: link };
    }
  };

  // Compare deployments
  const toggleCompare = (id: string) => {
    setCompareIds(prev => {
      if (prev.includes(id)) return prev.filter(i => i !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  const openNewDeploy = () => {
    setEditingDeployId(null);
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    setDeployForm({
      environment: environments[0]?.name || '',
      status: 'Success',
      branch: '',
      version: '',
      datetime: now.toISOString().slice(0, 16),
      duration: '',
      requested_by: '',
      approved_by: '',
      tested_by: '',
      deployed_by: '',
      ticket_link: '',
      notes: ''
    });
    setShowDeployModal(true);
  };

  const openEditDeploy = (deployment: Deployment) => {
    setEditingDeployId(deployment.id);
    setDeployForm({
      environment: deployment.environment,
      status: deployment.status,
      branch: deployment.branch || '',
      version: deployment.version || '',
      datetime: deployment.started_at?.slice(0, 16) || '',
      duration: deployment.duration || '',
      requested_by: deployment.requested_by || '',
      approved_by: deployment.approved_by || '',
      tested_by: deployment.tested_by || '',
      deployed_by: deployment.deployed_by || '',
      ticket_link: deployment.ticket_link || '',
      notes: deployment.notes || ''
    });
    setShowDeployModal(true);
  };

  const saveDeploy = async () => {
    if (!deployForm.environment || !deployForm.branch || !deployForm.requested_by || !deployForm.datetime) {
      alert('Please fill in Environment, Branch, Date & Time, and Requested By.');
      return;
    }
    const payload: any = {
      environment: deployForm.environment,
      status: deployForm.status,
      branch: deployForm.branch,
      version: deployForm.version,
      requested_by: deployForm.requested_by,
      approved_by: deployForm.approved_by,
      tested_by: deployForm.tested_by,
      deployed_by: deployForm.deployed_by,
      ticket_link: deployForm.ticket_link,
      notes: deployForm.notes,
      started_at: new Date(deployForm.datetime).toISOString(),
    };
    if (deployForm.duration) payload.duration = deployForm.duration;
    try {
      if (editingDeployId) {
        await fetch(`/api/deployments/${editingDeployId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } else {
        await fetch('/api/deployments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }
      setShowDeployModal(false);
      loadData();
    } catch (error) {
      alert('Failed to save deployment');
    }
  };

  const deleteDeploy = async (id: string) => {
    if (!confirm('Delete this deployment entry?')) return;
    try {
      await fetch(`/api/deployments/${id}`, { method: 'DELETE' });
      loadData();
    } catch (error) {
      alert('Failed to delete deployment');
    }
  };

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(deployments, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'deployment-tracker-export.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJSON = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const imported = JSON.parse(reader.result as string);
        if (!Array.isArray(imported)) throw new Error('Invalid format');
        let importCount = 0;
        for (const item of imported) {
          if (!deployments.find(d => d.id === item.id)) {
            await fetch('/api/deployments', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(item)
            });
            importCount++;
          }
        }
        alert(`Imported ${importCount} entries.`);
        loadData();
      } catch (error) {
        alert('Could not import file.');
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const filteredDeployments = deployments.filter(d => {
    if (filterEnv && d.environment !== filterEnv) return false;
    if (filterStatus && d.status !== filterStatus) return false;
    if (filterDate && !d.started_at.startsWith(filterDate)) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return [d.branch, d.version, d.ticket_link, d.requested_by, d.deployed_by, d.notes, d.frontend_branch, d.backend_branch]
        .some(field => field?.toLowerCase().includes(q));
    }
    return true;
  });

  const timelineData = getTimelineData();
  const maxDayTotal = Math.max(1, ...timelineData.map(d => {
    return Object.values(d.envData).reduce((sum, v) => sum + v.success + v.failed + v.other, 0);
  }));

  if (loading) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', color: 'var(--muted)' }}>Loading...</div>;
  }

  const compareDeployments = compareIds.length === 2
    ? [deployments.find(d => d.id === compareIds[0]), deployments.find(d => d.id === compareIds[1])]
    : [];

  return (
    <>
      <div className={`wrap ${theme}`} data-theme={theme}>
        {/* Header */}
        <header className="top">
          <div className="title-block">
            <h1>Deployment Tracker</h1>
            <div className="sub">
              <span className={`live-dot ${isRefreshing ? 'refreshing' : ''}`}>●</span>
              {' '}Live status · Last updated: {lastUpdated.toLocaleTimeString()}
            </div>
          </div>
          <div className="actions">
            <button className="btn ghost small" onClick={toggleTheme} title="Toggle theme">
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            {isAdmin ? (
              <>
                <button className="btn ghost small" onClick={() => setShowEnvModal(true)}>⚙ Environments</button>
                <button className="btn ghost small" onClick={exportJSON}>⬇ Export</button>
                <label className="btn ghost small" style={{ margin: 0 }}>
                  ⬆ Import
                  <input ref={fileInputRef} type="file" accept="application/json" onChange={importJSON} style={{ display: 'none' }} />
                </label>
                <button className="btn primary" onClick={openNewDeploy}>+ New Deployment</button>
                <button className="btn ghost small" onClick={() => window.location.href = '/admin'}>📊 Admin</button>
                <button className="btn ghost small danger" onClick={handleLogout}>Logout</button>
              </>
            ) : (
              <>
                <button className="btn ghost small" onClick={exportJSON}>⬇ Export</button>
                <button className="btn primary" onClick={() => setShowLoginModal(true)}>🔐 Admin Login</button>
              </>
            )}
          </div>
        </header>

        {/* Environment Cards */}
        <div className="cards">
          {[...environments].sort((a, b) => {
            const latestA = latestForEnv(a.name);
            const latestB = latestForEnv(b.name);
            if (!latestA && !latestB) return 0;
            if (!latestA) return 1;
            if (!latestB) return -1;
            return new Date(latestB.started_at).getTime() - new Date(latestA.started_at).getTime();
          }).map((env) => {
            const latest = latestForEnv(env.name);
            const branches = latestBranchesForEnv(env.name);
            const health = getEnvHealth(env.name);
            const lastTimes = getLastDeployTimes(env.name);
            return (
              <div key={env.name} className={`card ${env.isProd ? 'is-prod' : ''} ${health.status === 'critical' ? 'health-critical' : health.status === 'warning' ? 'health-warning' : ''}`}>
                <div className="stripe" style={{ background: env.color }} />
                <div className="env-name">
                  {env.name}
                  {env.isProd && <span className="prod-tag">LIVE</span>}
                </div>
                {/* Health Alert */}
                {health.label && (
                  <div className="health-alert" style={{ color: health.color }}>
                    {health.status === 'critical' ? '⚠' : health.status === 'warning' ? '⚡' : '⏰'} {health.label}
                  </div>
                )}
                {latest ? (
                  <>
                    <span className={`badge ${getStatusClass(latest.status)}`}>
                      <span className="b-dot" />
                      {latest.status}
                    </span>
                    <div className="meta">
                      <b>{new Date(latest.started_at).toLocaleString()}</b> · {timeAgo(latest.started_at)}
                      <br />
                      by {latest.deployed_by || latest.requested_by || '—'}
                      {(branches.fe || branches.be) ? (
                        <div style={{ marginTop: '8px', fontSize: '12px' }}>
                          <div className="branch" style={{ marginBottom: '4px' }}>
                            <span style={{ color: 'var(--accent)', fontWeight: 600, fontSize: '10px' }}>FE:</span> {branches.fe || '—'}
                          </div>
                          <div className="branch">
                            <span style={{ color: 'var(--ok)', fontWeight: 600, fontSize: '10px' }}>BE:</span> {branches.be || '—'}
                          </div>
                        </div>
                      ) : (
                        latest.branch && <div className="branch">{latest.branch}</div>
                      )}
                    </div>
                    {/* Last deploy times */}
                    {(lastTimes.feAgo || lastTimes.beAgo) && (
                      <div className="freq-stats">
                        {lastTimes.feAgo && <span>FE deployed {lastTimes.feAgo}</span>}
                        {lastTimes.beAgo && <span>BE deployed {lastTimes.beAgo}</span>}
                      </div>
                    )}
                  </>
                ) : (
                  <span className="badge none"><span className="b-dot" />No deploys yet</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Deployment Timeline */}
        <div className="timeline-section">
          <h3 className="section-title">Deployment Timeline (Last 14 Days)</h3>
          <div className="timeline">
            {timelineData.map(day => {
              const totalSuccess = Object.values(day.envData).reduce((s, v) => s + v.success, 0);
              const totalFailed = Object.values(day.envData).reduce((s, v) => s + v.failed, 0);
              const totalOther = Object.values(day.envData).reduce((s, v) => s + v.other, 0);
              const total = totalSuccess + totalFailed + totalOther;
              const barHeight = Math.max(4, (total / maxDayTotal) * 80);
              
              return (
                <div key={day.date} className="timeline-bar" title={`${day.label}: ${total} deployments (${totalSuccess} success, ${totalFailed} failed)`}>
                  <div className="bar-stack" style={{ height: `${barHeight}px` }}>
                    {totalFailed > 0 && (
                      <div className="bar-segment failed" style={{ height: `${(totalFailed / total) * 100}%` }} />
                    )}
                    {totalOther > 0 && (
                      <div className="bar-segment other" style={{ height: `${(totalOther / total) * 100}%` }} />
                    )}
                    {totalSuccess > 0 && (
                      <div className="bar-segment success" style={{ height: `${(totalSuccess / total) * 100}%` }} />
                    )}
                  </div>
                  <span className="bar-label">{day.label}</span>
                  {total > 0 && <span className="bar-count">{total}</span>}
                </div>
              );
            })}
          </div>
        </div>

        {/* Compare Bar */}
        {compareIds.length > 0 && (
          <div className="compare-bar">
            <span>{compareIds.length}/2 selected for comparison</span>
            {compareIds.length === 2 && (
              <button className="btn primary small" onClick={() => setShowCompareModal(true)}>
                Compare
              </button>
            )}
            <button className="btn ghost small" onClick={() => setCompareIds([])}>Clear</button>
          </div>
        )}

        {/* Filters */}
        <div className="filter-row">
          <select value={filterEnv} onChange={(e) => setFilterEnv(e.target.value)}>
            <option value="">All Environments</option>
            {environments.map((env) => (
              <option key={env.name} value={env.name}>{env.name}</option>
            ))}
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">All Statuses</option>
            <option value="Success">Success</option>
            <option value="In Progress">In Progress</option>
            <option value="Failed">Failed</option>
            <option value="Cancelled">Cancelled</option>
            <option value="Rolled Back">Rolled Back</option>
          </select>
          <input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} />
          {filterDate && (
            <button className="btn ghost small" onClick={() => setFilterDate('')}>✕ Clear date</button>
          )}
          <div className="search-wrap">
            <input type="search" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search branch, version, ticket, or names..." />
          </div>
          <div className="count">{filteredDeployments.length} {filteredDeployments.length === 1 ? 'entry' : 'entries'}</div>
        </div>

        {/* Table */}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: '40px' }}></th>
                <th>Environment</th>
                <th>Status</th>
                <th>Branch / Version</th>
                <th>Date & Time</th>
                <th>Requested By</th>
                <th>Approved By</th>
                <th>Tested By</th>
                <th>Ticket / Notes</th>
                {isAdmin && <th></th>}
              </tr>
            </thead>
            <tbody>
              {filteredDeployments.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 10 : 9} className="empty-state">
                    <div className="big">No deployments found</div>
                    <div>Try adjusting your filters or click &quot;+ New Deployment&quot; to add one.</div>
                  </td>
                </tr>
              ) : (
                filteredDeployments.map((d) => {
                  const ticketInfo = d.ticket_link ? formatTicketLink(d.ticket_link) : null;
                  return (
                    <tr key={d.id} className={compareIds.includes(d.id) ? 'compare-selected' : ''}>
                      <td>
                        <input
                          type="checkbox"
                          checked={compareIds.includes(d.id)}
                          onChange={() => toggleCompare(d.id)}
                          title="Select to compare"
                          className="compare-check"
                        />
                      </td>
                      <td className="env-cell">{d.environment}</td>
                      <td>
                        <span className={`badge ${getStatusClass(d.status)}`}>
                          <span className="b-dot" />
                          {d.status}
                        </span>
                      </td>
                      <td>
                        {d.frontend_branch || d.backend_branch ? (
                          <div>
                            {d.frontend_branch && (
                              <div className="mono" style={{ marginBottom: '4px' }}>
                                <span style={{ color: 'var(--accent)', fontSize: '10px', fontWeight: 600 }}>FE:</span> {d.frontend_branch}
                              </div>
                            )}
                            {d.backend_branch && (
                              <div className="mono">
                                <span style={{ color: 'var(--ok)', fontSize: '10px', fontWeight: 600 }}>BE:</span> {d.backend_branch}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div>
                            <div className="mono">{d.branch || '—'}</div>
                            {d.version && <div style={{ color: 'var(--muted)', fontSize: '11.5px', marginTop: '2px' }}>{d.version}</div>}
                          </div>
                        )}
                      </td>
                      <td>
                        {new Date(d.started_at).toLocaleString()}
                        {d.duration_seconds && (
                          <div style={{ color: 'var(--faint)', fontSize: '11px' }}>{formatDuration(d.duration_seconds)}</div>
                        )}
                      </td>
                      <td className="who">{d.requested_by || '—'}</td>
                      <td className="who">{d.approved_by || '—'}</td>
                      <td className="who">{d.tested_by || '—'}</td>
                      <td className="notes">
                        {ticketInfo ? (
                          <a href={ticketInfo.url} target="_blank" rel="noopener noreferrer" className="ticket-link" title={ticketInfo.fullText}>
                            🔗 {ticketInfo.text}
                          </a>
                        ) : d.ticket_link ? (
                          <div className="mono">{d.ticket_link}</div>
                        ) : null}
                        {d.notes && <div className="note-text">{d.notes}</div>}
                      </td>
                      {isAdmin && (
                        <td>
                          <div className="row-actions">
                            <button className="btn small ghost" onClick={() => openEditDeploy(d)}>Edit</button>
                            <button className="btn small ghost danger" onClick={() => deleteDeploy(d.id)}>Del</button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <footer className="note">
          <span className={`live-dot ${isRefreshing ? 'refreshing' : ''}`}>●</span>
          {' '}Auto-refreshing every 5s · Last updated: {lastUpdated.toLocaleTimeString()} · {deployments.length} total deployments
        </footer>
      </div>

      {/* Deploy Modal */}
      {showDeployModal && (
        <div className="overlay open" onClick={(e) => e.target === e.currentTarget && setShowDeployModal(false)}>
          <div className="modal">
            <h2>{editingDeployId ? 'Edit Deployment' : 'New Deployment'}</h2>
            <div className="field-grid">
              <div className="field">
                <label>Environment <span className="req-star">*</span></label>
                <select value={deployForm.environment} onChange={(e) => setDeployForm({ ...deployForm, environment: e.target.value })}>
                  {environments.map((env) => (<option key={env.name} value={env.name}>{env.name}</option>))}
                </select>
              </div>
              <div className="field">
                <label>Status <span className="req-star">*</span></label>
                <select value={deployForm.status} onChange={(e) => setDeployForm({ ...deployForm, status: e.target.value })}>
                  <option>Success</option><option>In Progress</option><option>Failed</option><option>Cancelled</option><option>Rolled Back</option>
                </select>
              </div>
              <div className="field">
                <label>Branch <span className="req-star">*</span></label>
                <input type="text" value={deployForm.branch} onChange={(e) => setDeployForm({ ...deployForm, branch: e.target.value })} placeholder="release/v2.4.1" />
              </div>
              <div className="field">
                <label>Version / Build Tag</label>
                <input type="text" value={deployForm.version} onChange={(e) => setDeployForm({ ...deployForm, version: e.target.value })} placeholder="v2.4.1-build882" />
              </div>
              <div className="field">
                <label>Date & Time <span className="req-star">*</span></label>
                <input type="datetime-local" value={deployForm.datetime} onChange={(e) => setDeployForm({ ...deployForm, datetime: e.target.value })} />
              </div>
              <div className="field">
                <label>Duration (optional)</label>
                <input type="text" value={deployForm.duration} onChange={(e) => setDeployForm({ ...deployForm, duration: e.target.value })} placeholder="e.g. 12 min" />
              </div>
              <div className="field">
                <label>Requested By <span className="req-star">*</span></label>
                <input type="text" value={deployForm.requested_by} onChange={(e) => setDeployForm({ ...deployForm, requested_by: e.target.value })} placeholder="Name" />
              </div>
              <div className="field"><label>Approved By</label><input type="text" value={deployForm.approved_by} onChange={(e) => setDeployForm({ ...deployForm, approved_by: e.target.value })} placeholder="Name" /></div>
              <div className="field"><label>Tested By</label><input type="text" value={deployForm.tested_by} onChange={(e) => setDeployForm({ ...deployForm, tested_by: e.target.value })} placeholder="Name" /></div>
              <div className="field"><label>Deployed By</label><input type="text" value={deployForm.deployed_by} onChange={(e) => setDeployForm({ ...deployForm, deployed_by: e.target.value })} placeholder="Name" /></div>
              <div className="field full"><label>Ticket / PR Link</label><input type="text" value={deployForm.ticket_link} onChange={(e) => setDeployForm({ ...deployForm, ticket_link: e.target.value })} placeholder="JIRA-1234 or PR URL" /></div>
              <div className="field full"><label>Notes</label><textarea value={deployForm.notes} onChange={(e) => setDeployForm({ ...deployForm, notes: e.target.value })} placeholder="Rollback reason, migration notes, hotfix details..." /></div>
            </div>
            <div className="modal-footer">
              <button className="btn ghost" onClick={() => setShowDeployModal(false)}>Cancel</button>
              <button className="btn primary" onClick={saveDeploy}>Save Deployment</button>
            </div>
          </div>
        </div>
      )}

      {/* Environment Modal */}
      {showEnvModal && (
        <div className="overlay open" onClick={(e) => e.target === e.currentTarget && setShowEnvModal(false)}>
          <div className="modal" style={{ minWidth: '500px' }}>
            <h2>Manage Environments</h2>
            <div style={{ marginBottom: '20px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: 'var(--muted)' }}>Current Environments</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {environments.map((env, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '6px' }}>
                    <div style={{ width: '12px', height: '12px', background: env.color, borderRadius: '3px' }}></div>
                    <span style={{ flex: 1, fontSize: '13px', fontWeight: 500 }}>
                      {env.name}
                      {env.isProd && <span style={{ marginLeft: '8px', fontSize: '10px', padding: '2px 6px', background: 'var(--prod)', color: '#0B0E14', borderRadius: '4px', fontWeight: 700 }}>LIVE</span>}
                    </span>
                    <button className="btn small danger" onClick={async () => {
                      if (confirm(`Delete "${env.name}" environment?`)) {
                        try {
                          const envs = await fetch('/api/environments');
                          const envData = await envs.json();
                          const envToDelete = envData.find((e: any) => e.name === env.name);
                          if (envToDelete) {
                            const res = await fetch(`/api/environments/${envToDelete.id}`, { method: 'DELETE' });
                            if (res.ok) loadData();
                          }
                        } catch (error) { console.error(error); }
                      }
                    }}>Delete</button>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ padding: '16px', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: '8px', marginBottom: '20px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Add New Environment</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <input type="text" placeholder="Environment name" value={newEnvForm.name} onChange={(e) => setNewEnvForm({...newEnvForm, name: e.target.value})} style={{ padding: '8px 12px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '13px' }} />
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                  <input type="checkbox" checked={newEnvForm.isProd} onChange={(e) => setNewEnvForm({...newEnvForm, isProd: e.target.checked})} />
                  Production environment
                </label>
                <button className="btn primary small" onClick={async () => {
                  if (!newEnvForm.name.trim()) { alert('Environment name is required'); return; }
                  try {
                    const res = await fetch('/api/environments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newEnvForm.name, is_production: newEnvForm.isProd, display_order: environments.length + 1 }) });
                    if (res.ok) { setNewEnvForm({ name: '', color: '#5B8DEF', isProd: false, description: '' }); loadData(); }
                    else { const error = await res.json(); alert('Error: ' + (error.error || 'Failed')); }
                  } catch (error) { alert('Failed to create environment'); }
                }}>+ Add Environment</button>
              </div>
            </div>
            <div className="modal-footer"><button className="btn ghost" onClick={() => setShowEnvModal(false)}>Done</button></div>
          </div>
        </div>
      )}

      {/* Login Modal */}
      {showLoginModal && (
        <div className="overlay open" onClick={(e) => e.target === e.currentTarget && setShowLoginModal(false)}>
          <div className="modal" style={{ minWidth: '400px' }}>
            <h2>🔐 Admin Login</h2>
            <div style={{ marginBottom: '20px', color: 'var(--muted)', fontSize: '13px' }}>Enter admin password to access management features</div>
            <input type="password" placeholder="Admin password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleLogin()} autoFocus style={{ width: '100%', padding: '12px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '14px', marginBottom: '20px' }} />
            <div className="modal-footer">
              <button className="btn ghost" onClick={() => { setShowLoginModal(false); setLoginPassword(''); }}>Cancel</button>
              <button className="btn primary" onClick={handleLogin}>Login</button>
            </div>
          </div>
        </div>
      )}

      {/* Compare Modal */}
      {showCompareModal && compareDeployments.length === 2 && compareDeployments[0] && compareDeployments[1] && (
        <div className="overlay open" onClick={(e) => e.target === e.currentTarget && setShowCompareModal(false)}>
          <div className="modal" style={{ minWidth: '700px', maxWidth: '800px' }}>
            <h2>Compare Deployments</h2>
            <div className="compare-grid">
              {(['environment', 'status', 'branch', 'frontend_branch', 'backend_branch', 'version', 'started_at', 'requested_by', 'deployed_by', 'notes'] as const).map(field => {
                const v1 = String((compareDeployments[0] as any)?.[field] || '—');
                const v2 = String((compareDeployments[1] as any)?.[field] || '—');
                const isDiff = v1 !== v2;
                const label = field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                return (
                  <div key={field} className="compare-row">
                    <div className="compare-label">{label}</div>
                    <div className={`compare-val ${isDiff ? 'diff' : ''}`}>
                      {field === 'started_at' ? new Date(v1).toLocaleString() : v1}
                    </div>
                    <div className={`compare-val ${isDiff ? 'diff' : ''}`}>
                      {field === 'started_at' ? new Date(v2).toLocaleString() : v2}
                    </div>
                  </div>
                );
              })}
              {/* Time difference */}
              {compareDeployments[0] && compareDeployments[1] && (
                <div className="compare-row">
                  <div className="compare-label">Time Difference</div>
                  <div className="compare-val" style={{ gridColumn: 'span 2', textAlign: 'center', color: 'var(--accent)' }}>
                    {formatDuration(Math.abs(Math.round((new Date(compareDeployments[0].started_at).getTime() - new Date(compareDeployments[1].started_at).getTime()) / 1000)))}
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn ghost" onClick={() => { setShowCompareModal(false); setCompareIds([]); }}>Close</button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

        :global(*) { box-sizing: border-box; }
        :global(body) {
          margin: 0;
          min-height: 100vh;
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          transition: background .3s, color .3s;
        }

        /* Dark Theme (default) */
        .wrap.dark { --bg: #0B0E14; --text: #E6E8EB; --muted: #9BA1AA; --faint: #6B7280; --panel: #161A23; --panel-2: #1C2128; --border: #2D333E; --accent: #5B8DEF; --ok: #3DD68C; --warn: #F5B942; --bad: #FF6B6B; --prod: #F5A623; --ok-bg: rgba(61,214,140,.12); --warn-bg: rgba(245,185,66,.12); --bad-bg: rgba(255,107,107,.12); --neutral-bg: rgba(138,147,168,.12); --neutral: #8A93A8; }
        /* Light Theme */
        .wrap.light { --bg: #F5F7FA; --text: #1A202C; --muted: #64748B; --faint: #94A3B8; --panel: #FFFFFF; --panel-2: #F1F5F9; --border: #E2E8F0; --accent: #3B6FD4; --ok: #16A34A; --warn: #D97706; --bad: #DC2626; --prod: #EA580C; --ok-bg: rgba(22,163,74,.1); --warn-bg: rgba(217,119,6,.1); --bad-bg: rgba(220,38,38,.1); --neutral-bg: rgba(100,116,139,.1); --neutral: #64748B; }

        .wrap {
          width: 100%; max-width: none; margin: 0; padding: 32px clamp(16px, 2vw, 24px) 80px;
          background: var(--bg); color: var(--text); min-height: 100vh;
          transition: background .3s, color .3s;
        }
        .wrap.dark { background: radial-gradient(1200px 600px at 10% -10%, rgba(91,141,239,0.08), transparent), radial-gradient(900px 500px at 100% 0%, rgba(245,166,35,0.05), transparent), var(--bg); }

        header.top { display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 16px; margin-bottom: 28px; }
        .title-block h1 { font-family: 'Space Grotesk', sans-serif; font-size: 28px; font-weight: 700; margin: 0 0 4px; letter-spacing: -0.02em; }
        .title-block .sub { color: var(--muted); font-size: 14px; }

        .live-dot { color: var(--ok); animation: livePulse 2s infinite; display: inline-block; }
        .live-dot.refreshing { animation: liveRefresh 0.3s ease; color: var(--accent); }
        @keyframes livePulse { 0%,100% { opacity: 1; } 50% { opacity: .4; } }
        @keyframes liveRefresh { 0% { transform: scale(1); } 50% { transform: scale(1.5); } 100% { transform: scale(1); } }

        .actions { display: flex; gap: 10px; flex-wrap: wrap; }
        button { font-family: inherit; cursor: pointer; }
        .btn {
          background: var(--panel-2); border: 1px solid var(--border); color: var(--text);
          padding: 10px 16px; border-radius: 8px; font-size: 13px; font-weight: 600;
          display: inline-flex; align-items: center; gap: 8px; transition: .15s;
        }
        .btn:hover { border-color: var(--accent); color: var(--accent); }
        .btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
        .wrap.dark .btn.primary { color: #0B0E14; }
        .btn.primary:hover { opacity: .9; }
        .btn.ghost { background: transparent; }
        .btn.small { padding: 6px 10px; font-size: 12px; }
        .btn.danger:hover { border-color: var(--bad); color: var(--bad); }

        .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; margin-bottom: 32px; }
        .card {
          background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
          padding: 16px; position: relative; overflow: hidden; min-height: 132px;
          display: flex; flex-direction: column; gap: 6px; transition: border-color .3s;
        }
        .card.is-prod { border-color: rgba(245,166,35,0.35); }
        .card.health-critical { border-color: var(--bad); box-shadow: 0 0 12px rgba(255,107,107,.15); }
        .card.health-warning { border-color: var(--warn); }
        .card .stripe { position: absolute; top: 0; left: 0; right: 0; height: 3px; }
        .card .env-name { font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 15px; display: flex; align-items: center; gap: 6px; }
        .card .env-name .prod-tag { font-size: 9px; background: var(--prod); color: #fff; padding: 2px 6px; border-radius: 4px; font-weight: 700; letter-spacing: .04em; }
        .wrap.dark .card .env-name .prod-tag { color: #1a1300; }

        .health-alert { font-size: 11px; font-weight: 600; padding: 3px 0; }

        .freq-stats {
          display: flex; gap: 8px; margin-top: 6px; padding-top: 6px;
          border-top: 1px solid var(--border); font-size: 11px; color: var(--faint);
        }
        .freq-stats span { display: flex; align-items: center; gap: 2px; }

        .badge {
          display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 100px;
          font-size: 11px; font-weight: 600; letter-spacing: .02em; width: fit-content;
        }
        .b-dot { width: 6px; height: 6px; border-radius: 50%; }
        .badge.success { background: var(--ok-bg); color: var(--ok); }
        .badge.success .b-dot { background: var(--ok); }
        .badge.progress { background: var(--warn-bg); color: var(--warn); }
        .badge.progress .b-dot { background: var(--warn); animation: pulse 1.4s infinite; }
        .badge.failed { background: var(--bad-bg); color: var(--bad); }
        .badge.failed .b-dot { background: var(--bad); }
        .badge.rollback { background: var(--neutral-bg); color: var(--neutral); }
        .badge.rollback .b-dot { background: var(--neutral); }
        .badge.cancelled { background: rgba(138,147,168,0.14); color: var(--faint); }
        .badge.cancelled .b-dot { background: var(--faint); }
        .badge.none { background: rgba(128,128,128,0.08); color: var(--faint); }
        .badge.none .b-dot { background: var(--faint); }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .3; } }

        .card .meta { font-size: 12px; color: var(--muted); line-height: 1.6; }
        .card .meta b { color: var(--text); font-weight: 500; }
        .card .branch { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); background: rgba(91,141,239,0.08); padding: 2px 6px; border-radius: 4px; display: inline-block; margin-top: 4px; }

        /* Timeline */
        .timeline-section { margin-bottom: 28px; }
        .section-title { font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 600; margin: 0 0 14px; }
        .timeline {
          display: flex; gap: 4px; align-items: flex-end; height: 120px;
          background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
          padding: 16px 12px 8px; overflow-x: auto;
        }
        .timeline-bar {
          flex: 1; min-width: 40px; display: flex; flex-direction: column; align-items: center; gap: 4px; cursor: default;
        }
        .bar-stack { display: flex; flex-direction: column-reverse; width: 100%; max-width: 40px; border-radius: 3px 3px 0 0; overflow: hidden; transition: height .3s; }
        .bar-segment { width: 100%; min-height: 2px; }
        .bar-segment.success { background: var(--ok); }
        .bar-segment.failed { background: var(--bad); }
        .bar-segment.other { background: var(--warn); }
        .bar-label { font-size: 9px; color: var(--faint); white-space: nowrap; }
        .bar-count { font-size: 10px; color: var(--muted); font-weight: 600; }

        /* Compare */
        .compare-bar {
          display: flex; align-items: center; gap: 12px; padding: 10px 16px;
          background: var(--panel); border: 1px solid var(--accent); border-radius: 8px;
          margin-bottom: 16px; font-size: 13px; color: var(--accent);
        }
        .compare-check { cursor: pointer; accent-color: var(--accent); }
        tr.compare-selected { background: rgba(91,141,239,0.06) !important; }
        .compare-grid { display: grid; grid-template-columns: 140px 1fr 1fr; gap: 0; }
        .compare-row { display: contents; }
        .compare-label { padding: 8px 12px; font-size: 12px; font-weight: 600; color: var(--muted); border-bottom: 1px solid var(--border); display: flex; align-items: center; }
        .compare-val { padding: 8px 12px; font-size: 13px; border-bottom: 1px solid var(--border); font-family: 'JetBrains Mono', monospace; font-size: 12px; word-break: break-all; }
        .compare-val.diff { background: rgba(91,141,239,0.08); color: var(--accent); }

        .filter-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 16px; }
        select, input[type=text], input[type=search], input[type=date], textarea {
          background: var(--panel-2); border: 1px solid var(--border); color: var(--text);
          padding: 9px 12px; border-radius: 8px; font-size: 13px; font-family: inherit;
        }
        select:focus, input:focus, textarea:focus { outline: none; border-color: var(--accent); }
        .wrap.dark input[type=date], .wrap.dark input[type=datetime-local] { color-scheme: dark; }
        .wrap.light input[type=date], .wrap.light input[type=datetime-local] { color-scheme: light; }
        input[type=datetime-local] { background: var(--panel-2); border: 1px solid var(--border); color: var(--text); padding: 9px 12px; border-radius: 8px; font-size: 13px; }
        .search-wrap { flex: 1; min-width: 240px; }
        .search-wrap input { width: 100%; }
        .filter-row .count { margin-left: auto; color: var(--faint); font-size: 12px; }

        .table-wrap { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; overflow-x: auto; overflow-y: hidden; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 1100px; }
        thead th {
          text-align: left; padding: 12px 14px; background: var(--panel-2); color: var(--muted);
          font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: .05em;
          border-bottom: 1px solid var(--border); white-space: nowrap;
        }
        tbody td { padding: 13px 14px; border-bottom: 1px solid var(--border); vertical-align: top; }
        tbody tr:last-child td { border-bottom: none; }
        tbody tr:hover { background: rgba(128,128,128,0.04); }
        td.env-cell { font-weight: 600; }
        td .mono { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--accent); }
        td.who { color: var(--muted); font-size: 12.5px; }
        td.notes { color: var(--muted); max-width: 220px; font-size: 12.5px; }
        .row-actions { display: flex; gap: 6px; }
        .empty-state { padding: 60px 20px; text-align: center; color: var(--faint); }
        .empty-state .big { font-size: 15px; color: var(--muted); margin-bottom: 6px; }

        .ticket-link {
          color: var(--accent); text-decoration: none; font-family: 'JetBrains Mono', monospace;
          font-size: 12px; display: inline-flex; align-items: center; gap: 4px;
          padding: 2px 6px; background: rgba(91,141,239,0.08); border-radius: 4px;
          transition: .15s;
        }
        .ticket-link:hover { background: rgba(91,141,239,0.18); text-decoration: underline; }
        .note-text { margin-top: 4px; font-size: 12px; color: var(--faint); }

        .overlay { display: none; position: fixed; inset: 0; background: rgba(5,7,12,0.7); backdrop-filter: blur(3px); z-index: 50; align-items: flex-start; justify-content: center; overflow-y: auto; padding: 40px 16px; }
        .wrap.light ~ .overlay { background: rgba(0,0,0,0.3); }
        .overlay.open { display: flex; }
        .modal { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; width: 100%; max-width: 560px; padding: 26px; }
        .modal h2 { font-family: 'Space Grotesk', sans-serif; margin: 0 0 18px; font-size: 19px; }
        .field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .field { display: flex; flex-direction: column; gap: 6px; }
        .field.full { grid-column: 1/-1; }
        .field label { font-size: 12px; color: var(--muted); font-weight: 600; }
        .field select, .field input, .field textarea { width: 100%; }
        .field textarea { resize: vertical; min-height: 56px; }
        .modal-footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
        .req-star { color: var(--bad); }

        footer.note { margin-top: 28px; color: var(--faint); font-size: 11.5px; line-height: 1.6; text-align: center; }

        :global(::-webkit-scrollbar) { height: 8px; width: 8px; }
        :global(::-webkit-scrollbar-thumb) { background: var(--border); border-radius: 4px; }
      `}</style>
    </>
  );
}
