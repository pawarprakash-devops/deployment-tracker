'use client';

import { useState, useEffect, useRef } from 'react';

interface Deployment {
  id: string;
  environment: string;
  status: string;
  branch?: string;
  version?: string;
  requested_by?: string;
  approved_by?: string;
  tested_by?: string;
  deployed_by?: string;
  ticket_link?: string;
  notes?: string;
  started_at: string;
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

  useEffect(() => {
    loadData();
    const interval = setInterval(() => {
      loadData();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      const [deploymentsRes, environmentsRes] = await Promise.all([
        fetch('/api/deployments?limit=500'),
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
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const cryptoId = () => 'd_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  const escapeHtml = (text: string | undefined | null) => {
    if (!text) return '';
    return String(text).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c] || c));
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

  const timeAgo = (isoDate: string) => {
    const diff = (Date.now() - new Date(isoDate).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  const latestForEnv = (envName: string) => {
    return deployments
      .filter(d => d.environment === envName)
      .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())[0];
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

    if (deployForm.duration) {
      payload.duration = deployForm.duration;
    }

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
        alert('Could not import file — make sure it is a valid export from this tracker.');
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
      return [d.branch, d.version, d.ticket_link, d.requested_by, d.deployed_by, d.notes]
        .some(field => field?.toLowerCase().includes(q));
    }
    return true;
  });

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">
      <div className="text-xl" style={{ color: 'var(--muted)' }}>Loading...</div>
    </div>;
  }

  return (
    <>
      <div className="wrap">
        {/* Header */}
        <header className="top">
          <div className="title-block">
            <h1>Deployment Tracker</h1>
            <div className="sub">
              <span className="dot">●</span> Live status across QA, Stage, Preview, Pre-Prod, Pre-Prod USW & Production
            </div>
          </div>
          <div className="actions">
            <button className="btn ghost small" onClick={() => setShowEnvModal(true)}>
              ⚙ Manage Environments
            </button>
            <button className="btn ghost small" onClick={exportJSON}>
              ⭳ Export JSON
            </button>
            <label className="btn ghost small" style={{ margin: 0 }}>
              ⭱ Import JSON
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                onChange={importJSON}
                style={{ display: 'none' }}
              />
            </label>
            <button className="btn primary" onClick={openNewDeploy}>
              + New Deployment
            </button>
          </div>
        </header>

        {/* Environment Cards */}
        <div className="cards">
          {environments.map((env) => {
            const latest = latestForEnv(env.name);
            return (
              <div key={env.name} className={`card ${env.isProd ? 'is-prod' : ''}`}>
                <div className="stripe" style={{ background: env.color }} />
                <div className="env-name">
                  {env.name}
                  {env.isProd && <span className="prod-tag">LIVE</span>}
                </div>
                {env.description && <div className="env-desc">{env.description}</div>}
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
                      {latest.branch && <div className="branch">{latest.branch}</div>}
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

          <input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
          />

          {filterDate && (
            <button className="btn ghost small" onClick={() => setFilterDate('')}>
              ✕ Clear date
            </button>
          )}

          <div className="search-wrap">
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search branch, version, ticket, or names…"
            />
          </div>

          <div className="count">
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
                <th>Branch / Version</th>
                <th>Date & Time</th>
                <th>Requested By</th>
                <th>Approved By</th>
                <th>Tested By</th>
                <th>Ticket / Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredDeployments.length === 0 ? (
                <tr>
                  <td colSpan={9} className="empty-state">
                    <div className="big">No deployments found</div>
                    <div>Try adjusting your filters or click "+ New Deployment" to add one.</div>
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
                      <div className="mono">{d.branch || '—'}</div>
                      {d.version && (
                        <div style={{ color: 'var(--muted)', fontSize: '11.5px', marginTop: '2px' }}>
                          {d.version}
                        </div>
                      )}
                    </td>
                    <td>
                      {new Date(d.started_at).toLocaleString()}
                      {d.duration && (
                        <div style={{ color: 'var(--faint)', fontSize: '11px' }}>{d.duration}</div>
                      )}
                    </td>
                    <td className="who">{d.requested_by || '—'}</td>
                    <td className="who">{d.approved_by || '—'}</td>
                    <td className="who">{d.tested_by || '—'}</td>
                    <td className="notes">
                      {d.ticket_link && <div className="mono">{d.ticket_link}</div>}
                      {d.notes && <div>{d.notes}</div>}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button className="btn small ghost" onClick={() => openEditDeploy(d)}>
                          Edit
                        </button>
                        <button className="btn small ghost danger" onClick={() => deleteDeploy(d.id)}>
                          Del
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <footer className="note">
          Auto-refreshing every 5 seconds • Last updated: {new Date().toLocaleTimeString()}
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
                  {environments.map((env) => (
                    <option key={env.name} value={env.name}>{env.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Status <span className="req-star">*</span></label>
                <select value={deployForm.status} onChange={(e) => setDeployForm({ ...deployForm, status: e.target.value })}>
                  <option>Success</option>
                  <option>In Progress</option>
                  <option>Failed</option>
                  <option>Cancelled</option>
                  <option>Rolled Back</option>
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
              <div className="field">
                <label>Approved By</label>
                <input type="text" value={deployForm.approved_by} onChange={(e) => setDeployForm({ ...deployForm, approved_by: e.target.value })} placeholder="Name" />
              </div>
              <div className="field">
                <label>Tested By</label>
                <input type="text" value={deployForm.tested_by} onChange={(e) => setDeployForm({ ...deployForm, tested_by: e.target.value })} placeholder="Name" />
              </div>
              <div className="field">
                <label>Deployed By</label>
                <input type="text" value={deployForm.deployed_by} onChange={(e) => setDeployForm({ ...deployForm, deployed_by: e.target.value })} placeholder="Name" />
              </div>
              <div className="field full">
                <label>Ticket / PR Link</label>
                <input type="text" value={deployForm.ticket_link} onChange={(e) => setDeployForm({ ...deployForm, ticket_link: e.target.value })} placeholder="JIRA-1234 or PR URL" />
              </div>
              <div className="field full">
                <label>Notes</label>
                <textarea value={deployForm.notes} onChange={(e) => setDeployForm({ ...deployForm, notes: e.target.value })} placeholder="Rollback reason, migration notes, hotfix details…" />
              </div>
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
          <div className="modal">
            <h2>Manage Environments</h2>
            <div style={{ marginBottom: '18px', color: 'var(--muted)', fontSize: '13px' }}>
              Environment management will be available in the next update.
            </div>
            <div className="modal-footer">
              <button className="btn ghost" onClick={() => setShowEnvModal(false)}>Done</button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

        :global(*) { box-sizing: border-box; }
        :global(body) {
          margin: 0;
          background: radial-gradient(1200px 600px at 10% -10%, rgba(91,141,239,0.08), transparent),
                      radial-gradient(900px 500px at 100% 0%, rgba(245,166,35,0.05), transparent),
                      var(--bg);
          color: var(--text);
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          min-height: 100vh;
        }

        .wrap { width: 100%; max-width: none; margin: 0; padding: 32px clamp(16px, 2vw, 24px) 80px; }
        
        header.top { display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 16px; margin-bottom: 28px; }
        .title-block h1 { font-family: 'Space Grotesk', sans-serif; font-size: 28px; font-weight: 700; margin: 0 0 4px; letter-spacing: -0.02em; }
        .title-block .sub { color: var(--muted); font-size: 14px; }
        .title-block .sub .dot { color: var(--ok); }
        
        .actions { display: flex; gap: 10px; flex-wrap: wrap; }
        button { font-family: inherit; cursor: pointer; }
        .btn {
          background: var(--panel-2); border: 1px solid var(--border); color: var(--text);
          padding: 10px 16px; border-radius: 8px; font-size: 13px; font-weight: 600;
          display: inline-flex; align-items: center; gap: 8px; transition: .15s;
        }
        .btn:hover { border-color: var(--accent); color: #fff; }
        .btn.primary { background: var(--accent); border-color: var(--accent); color: #0B0E14; }
        .btn.primary:hover { background: #7AA3F5; }
        .btn.ghost { background: transparent; }
        .btn.small { padding: 6px 10px; font-size: 12px; }
        .btn.danger:hover { border-color: var(--bad); color: var(--bad); }

        .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-bottom: 32px; }
        .card {
          background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
          padding: 16px; position: relative; overflow: hidden; min-height: 132px;
          display: flex; flex-direction: column; justify-content: space-between;
        }
        .card.is-prod { border-color: rgba(245,166,35,0.35); }
        .card .stripe { position: absolute; top: 0; left: 0; right: 0; height: 3px; }
        .card .env-name { font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 15px; display: flex; align-items: center; gap: 6px; }
        .card .env-name .prod-tag { font-size: 9px; background: var(--prod); color: #1a1300; padding: 2px 6px; border-radius: 4px; font-weight: 700; letter-spacing: .04em; }
        .card .env-desc { font-size: 11px; color: var(--faint); margin-top: -4px; }
        
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
        .badge.cancelled { background: rgba(138,147,168,0.14); color: #B7BECC; }
        .badge.cancelled .b-dot { background: #B7BECC; }
        .badge.none { background: rgba(255,255,255,0.04); color: var(--faint); }
        .badge.none .b-dot { background: var(--faint); }
        
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .3; } }
        
        .card .meta { font-size: 12px; color: var(--muted); line-height: 1.6; }
        .card .meta b { color: var(--text); font-weight: 500; }
        .card .branch { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent); background: rgba(91,141,239,0.08); padding: 2px 6px; border-radius: 4px; display: inline-block; margin-top: 4px; }

        .filter-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 16px; }
        select, input[type=text], input[type=search], input[type=date], textarea {
          background: var(--panel-2); border: 1px solid var(--border); color: var(--text);
          padding: 9px 12px; border-radius: 8px; font-size: 13px; font-family: inherit;
        }
        select:focus, input:focus, textarea:focus { outline: none; border-color: var(--accent); }
        input[type=date] { color-scheme: dark; }
        input[type=datetime-local] { color-scheme: dark; background: var(--panel-2); border: 1px solid var(--border); color: var(--text); padding: 9px 12px; border-radius: 8px; font-size: 13px; }
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
        tbody tr:hover { background: rgba(255,255,255,0.015); }
        td.env-cell { font-weight: 600; }
        td .mono { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--accent); }
        td.who { color: var(--muted); font-size: 12.5px; }
        td.notes { color: var(--muted); max-width: 220px; font-size: 12.5px; }
        .row-actions { display: flex; gap: 6px; }
        .empty-state { padding: 60px 20px; text-align: center; color: var(--faint); }
        .empty-state .big { font-size: 15px; color: var(--muted); margin-bottom: 6px; }

        .overlay { display: none; position: fixed; inset: 0; background: rgba(5,7,12,0.7); backdrop-filter: blur(3px); z-index: 50; align-items: flex-start; justify-content: center; overflow-y: auto; padding: 40px 16px; }
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
