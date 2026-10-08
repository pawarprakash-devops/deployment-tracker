'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, Chip, Empty, ErrorNote, Skeleton, StatusPill, ago } from './ui';

interface Row {
  id: string; environment: string; status: string; deployment_type?: string | null;
  branch?: string | null; version?: string | null;
  frontend_branch?: string | null; backend_branch?: string | null;
  frontend_version?: string | null; backend_version?: string | null;
  requested_by?: string | null; approved_by?: string | null; tested_by?: string | null; deployed_by?: string | null;
  ticket_link?: string | null; notes?: string | null;
  started_at: string; completed_at?: string | null; duration_seconds?: number | null;
}
type SortKey = 'when' | 'env' | 'status';
type DatePreset = '' | 'today' | '7d' | '30d' | 'custom';

const STATUSES = ['Success', 'In Progress', 'Failed', 'Rolled Back', 'Cancelled'];
const PAGE = 25;
const DAY = 86_400_000;

const isRerun = (s: string) => /^rerun\s*-/i.test(s);
const baseStatus = (s: string) => s.replace(/^rerun\s*-\s*/i, '').trim();
const isProd = (e: string) => /^production/i.test(e);
const isUrl = (s?: string | null): s is string => !!s && /^https?:\/\//i.test(s);

interface PR { type: 'FE' | 'BE' | 'PR'; url: string; label: string }
function extractPRs(notes?: string | null, link?: string | null): PR[] {
  const text = `${notes || ''} ${link || ''}`;
  if (!text.trim()) return [];
  const feNote = /frontend/i.test(text) && !/backend/i.test(text);
  const beNote = /backend/i.test(text) && !/frontend/i.test(text);
  const seen = new Set<string>();
  const out: PR[] = [];
  for (const m of text.matchAll(/(?:(FE|BE)\s*#\s*|PR\s*#?\s*|#\s*)(\d{3,7})/gi)) {
    const prefix = m[1]?.toUpperCase() as 'FE' | 'BE' | undefined;
    const key = `${prefix || 'GEN'}-${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const type: PR['type'] = prefix || (beNote ? 'BE' : feNote ? 'FE' : 'PR');
    const repo = type === 'BE' ? 'vidai-backend' : 'vidai-react';
    out.push({ type, url: `https://github.com/vidaisolutions/${repo}/pull/${m[2]}`, label: prefix ? `${prefix}#${m[2]}` : `PR #${m[2]}` });
  }
  return out;
}

function ticketText(link: string): string {
  const run = link.match(/github\.com\/[^/]+\/[^/]+\/actions\/runs\/(\d+)/);
  if (run) return `#${run[1]}`;
  const pr = link.match(/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/);
  if (pr) return `PR #${pr[1]}`;
  return link.length > 40 ? `${link.slice(0, 40)}…` : link;
}

function dur(sec?: number | null): string {
  if (sec == null) return '';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}
const abs = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : '—');
const dash = <span className="muted">—</span>;

function Linkified({ text }: { text: string }) {
  return <>{text.split(/(https?:\/\/[^\s<>"')]+)/g).map((p, i) =>
    i % 2 ? <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="key" style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{p}</a> : p)}</>;
}

function Notes({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 140 || text.split('\n').length > 3;
  const clamp = !open && long;
  return (
    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', marginTop: 4, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxWidth: 320 }}>
      <div style={clamp ? { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : undefined}><Linkified text={text} /></div>
      {long && <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        style={{ background: 'none', border: 0, padding: 0, color: 'var(--accent-text)', fontSize: 'var(--fs-xs)' }}>{open ? 'less' : 'more'}</button>}
    </div>
  );
}

function PRChips({ prs }: { prs: PR[] }) {
  return <>{prs.map((p) => (
    <a key={p.label} href={p.url} target="_blank" rel="noopener noreferrer" title={`GitHub ${p.type} pull request`} className="vchip tnum"
      style={{ color: p.type === 'BE' ? 'var(--ok-text)' : p.type === 'FE' ? 'var(--accent-text)' : undefined }}>🔀 {p.label}</a>
  ))}</>;
}

const person = (v?: string | null) => (v ? <span style={{ whiteSpace: 'nowrap' }}>{v}</span> : dash);
const plain = { background: 'none', border: 0, padding: 0, color: 'inherit', font: 'inherit', cursor: 'pointer' } as const;

export default function ReleaseHistory() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [admin, setAdmin] = useState(false);
  const [q, setQ] = useState('');
  const [env, setEnv] = useState('');
  const [status, setStatus] = useState('');
  const [datePreset, setDatePreset] = useState<DatePreset>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [prodOnly, setProdOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'when', dir: 'desc' });
  const [limit, setLimit] = useState(PAGE);
  const [picked, setPicked] = useState<string[]>([]);
  const [sel, setSel] = useState<Row | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/deployments?limit=1000', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as Row[];
      setRows(Array.isArray(j) ? j : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, []);

  const loadAuth = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/session', { cache: 'no-store' });
      const j = (await r.json()) as { authenticated?: boolean; role?: string };
      setAdmin(!!j.authenticated && j.role === 'admin');
    } catch { setAdmin(false); }
  }, []);

  useEffect(() => {
    load(); loadAuth();
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 90_000);
    const onData = () => { load(); };
    const onAuth = () => { loadAuth(); };
    window.addEventListener('tracker:data-changed', onData);
    window.addEventListener('tracker:refresh', onData);
    window.addEventListener('tracker:auth-changed', onAuth);
    return () => {
      clearInterval(t);
      window.removeEventListener('tracker:data-changed', onData);
      window.removeEventListener('tracker:refresh', onData);
      window.removeEventListener('tracker:auth-changed', onAuth);
    };
  }, [load, loadAuth]);

  const envs = useMemo(() => [...new Set((rows ?? []).map((r) => r.environment))].sort(), [rows]);
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    const now = Date.now();
    const sod = new Date(); sod.setHours(0, 0, 0, 0);
    let lo = -Infinity, hi = Infinity;
    if (datePreset === 'today') lo = sod.getTime();
    else if (datePreset === '7d') lo = now - 7 * DAY;
    else if (datePreset === '30d') lo = now - 30 * DAY;
    else if (datePreset === 'custom') {
      if (from) lo = new Date(`${from}T00:00:00`).getTime();
      if (to) hi = new Date(`${to}T23:59:59.999`).getTime();
    }
    const out = (rows ?? []).filter((r) => {
      if (env && r.environment !== env) return false;
      if (status && baseStatus(r.status) !== status) return false;
      if (prodOnly && !isProd(r.environment)) return false;
      const t = new Date(r.started_at).getTime();
      if (t < lo || t > hi) return false;
      if (!n) return true;
      return [r.branch, r.version, r.ticket_link, r.requested_by, r.deployed_by, r.notes, r.frontend_branch, r.backend_branch]
        .some((f) => f?.toLowerCase().includes(n));
    });
    const m = sort.dir === 'asc' ? 1 : -1;
    return out.sort((a, b) => {
      const c = sort.key === 'env' ? a.environment.localeCompare(b.environment)
        : sort.key === 'status' ? baseStatus(a.status).localeCompare(baseStatus(b.status))
        : +new Date(a.started_at) - +new Date(b.started_at);
      return (c || +new Date(a.started_at) - +new Date(b.started_at)) * m;
    });
  }, [rows, q, env, status, prodOnly, datePreset, from, to, sort]);
  const shown = filtered.slice(0, limit);
  const filtersActive = !!(q || env || status || prodOnly || datePreset);

  useEffect(() => {
    if (!sel) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSel(null); return; }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const f = panelRef.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!panelRef.current.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    const o = opener.current;
    return () => { document.removeEventListener('keydown', onKey); o?.focus?.(); };
  }, [sel]);

  const open = (r: Row, el: HTMLElement | null) => { opener.current = el; setSel(r); };
  const reset = () => setLimit(PAGE);
  const clearAll = () => { setQ(''); setEnv(''); setStatus(''); setProdOnly(false); setDatePreset(''); setFrom(''); setTo(''); reset(); };
  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'when' ? 'desc' : 'asc' }));
  const togglePick = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-2)));
  const emit = (name: string, detail: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));
  const compare = () => {
    const two = picked.map((id) => (rows ?? []).find((r) => r.id === id)).filter((r): r is Row => !!r);
    if (two.length !== 2) return;
    const [a, b] = +new Date(two[0].started_at) <= +new Date(two[1].started_at) ? two : [two[1], two[0]];
    emit('tracker:compare', { a, b });
  };

  const selectStyle = { fontSize: 'var(--fs-sm)', minHeight: 32, border: '1px solid var(--border-bright)', background: 'var(--panel)', color: 'var(--text)', borderRadius: 'var(--r-sm)', padding: '4px 8px' } as const;
  const th = (label: string, key: SortKey) => (
    <th scope="col" aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => toggleSort(key)} style={{ ...plain, fontWeight: 600, color: 'var(--muted)', fontSize: 'var(--fs-xs)' }}>
        {label}<span aria-hidden="true"> {sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );
  const field = (label: string, v: React.ReactNode) => (
    <tr><td className="muted">{label}</td><td style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{v || '—'}</td></tr>
  );
  const selPrs = sel ? extractPRs(sel.notes, sel.ticket_link) : [];

  return (
    <Card title="Deployment history">
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
        <input type="search" aria-label="Search deployments" placeholder="Search branch, version, ticket, person, notes" value={q}
          onChange={(e) => { setQ(e.target.value); reset(); }} />
        <select aria-label="Filter by environment" style={selectStyle} value={env} onChange={(e) => { setEnv(e.target.value); reset(); }}>
          <option value="">All environments</option>
          {envs.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <select aria-label="Filter by status" style={selectStyle} value={status} onChange={(e) => { setStatus(e.target.value); reset(); }}>
          <option value="">All statuses</option>
          {STATUSES.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <select aria-label="Filter by date" style={selectStyle} value={datePreset} onChange={(e) => { setDatePreset(e.target.value as DatePreset); reset(); }}>
          <option value="">All time</option><option value="today">Today</option><option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option><option value="custom">Custom range</option>
        </select>
        {datePreset === 'custom' && <>
          <input type="date" aria-label="From date" style={selectStyle} value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); reset(); }} />
          <input type="date" aria-label="To date" style={selectStyle} value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); reset(); }} />
        </>}
        <button type="button" className="btn" aria-pressed={prodOnly} aria-label="Production only" onClick={() => { setProdOnly((v) => !v); reset(); }}>Production only</button>
        <button type="button" className="btn" aria-label="Clear filters" disabled={!filtersActive} onClick={clearAll}>Clear</button>
        {rows && <span className="muted" role="status" style={{ fontSize: 'var(--fs-sm)' }}>Showing {filtered.length} of {rows.length}</span>}
      </div>

      {picked.length > 0 && (
        <div role="region" aria-label="Compare deployments" style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-3)', padding: '6px 10px', background: 'rgba(var(--accent-rgb), .10)', border: '1px solid var(--accent)', borderRadius: 'var(--r-sm)' }}>
          <strong className="tnum" style={{ fontSize: 'var(--fs-sm)' }}>{picked.length}/2 selected</strong>
          <button type="button" className="btn" disabled={picked.length !== 2} onClick={compare}>Compare</button>
          <button type="button" className="btn" onClick={() => setPicked([])}>Clear</button>
        </div>
      )}

      {error && <ErrorNote>Could not load deployment history ({error}).{rows ? ' Showing last loaded data.' : ''}</ErrorNote>}
      {!rows && !error && <Skeleton rows={6} />}
      {rows && filtered.length === 0 && <Empty>No deployments match these filters.</Empty>}
      {shown.length > 0 && (
        <table style={{ minWidth: 1200 }}>
          <thead><tr>
            <th scope="col"><span className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Select</span></th>
            {th('Environment', 'env')}{th('Status', 'status')}
            <th scope="col">Branch / Version</th>{th('Date & Time', 'when')}
            <th scope="col">Requested By</th><th scope="col">Approved By</th><th scope="col">Tested By</th><th scope="col">Deployed By</th>
            <th scope="col">Ticket / Notes</th>
            {admin && <th scope="col">Actions</th>}
          </tr></thead>
          <tbody>
            {shown.map((r) => {
              const prs = extractPRs(r.notes, r.ticket_link);
              const checked = picked.includes(r.id);
              return (
                <tr key={r.id} style={checked ? { background: 'rgba(var(--accent-rgb), .08)' } : undefined}>
                  <td><input type="checkbox" checked={checked} onChange={() => togglePick(r.id)} aria-label={`Select ${r.environment} deployment, ${abs(r.started_at)}, for comparison`} /></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.environment} {isProd(r.environment) && <Chip>PROD</Chip>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}><StatusPill status={baseStatus(r.status)} /> {isRerun(r.status) && <Chip>rerun</Chip>}</td>
                  <td style={{ fontSize: 'var(--fs-xs)' }}>
                    {r.frontend_branch || r.backend_branch || r.frontend_version || r.backend_version ? (
                      <>
                        {(r.frontend_branch || r.frontend_version) && <div><b style={{ color: 'var(--accent-text)' }}>FE:</b> {r.frontend_branch || r.frontend_version}</div>}
                        {(r.backend_branch || r.backend_version) && <div><b style={{ color: 'var(--ok-text)' }}>BE:</b> {r.backend_branch || r.backend_version}</div>}
                      </>
                    ) : (
                      <>
                        <div>{r.branch || '—'}</div>
                        {r.version && <div className="muted">{r.version}</div>}
                      </>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button type="button" aria-label={`Open details for ${r.environment} deployment, ${abs(r.started_at)}`} style={plain}
                      onClick={(e) => open(r, e.currentTarget)}>{abs(r.started_at)}</button>
                    <div className="muted" style={{ fontSize: 'var(--fs-xs)' }}>{ago(r.started_at)}{r.duration_seconds != null && <> · <span className="tnum">{dur(r.duration_seconds)}</span></>}</div>
                  </td>
                  <td>{person(r.requested_by)}</td><td>{person(r.approved_by)}</td><td>{person(r.tested_by)}</td><td>{person(r.deployed_by)}</td>
                  <td style={{ minWidth: 220 }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      {r.ticket_link && (isUrl(r.ticket_link)
                        ? <a href={r.ticket_link} target="_blank" rel="noopener noreferrer" className="key" title={r.ticket_link}>🔗 {ticketText(r.ticket_link)}</a>
                        : <span title={r.ticket_link} style={{ overflowWrap: 'anywhere' }}>{r.ticket_link}</span>)}
                      <PRChips prs={prs} />
                    </div>
                    {r.notes && <Notes text={r.notes} />}
                  </td>
                  {admin && (
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button type="button" className="btn" onClick={() => emit('tracker:edit-deployment', r)} aria-label={`Edit ${r.environment} deployment, ${abs(r.started_at)}`}>Edit</button>{' '}
                      <button type="button" className="btn" style={{ color: 'var(--bad-text)' }} onClick={() => emit('tracker:delete-deployment', r)} aria-label={`Delete ${r.environment} deployment, ${abs(r.started_at)}`}>Delete</button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {filtered.length > shown.length && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <button type="button" className="btn" onClick={() => setLimit((l) => l + PAGE)}>Show more ({Math.min(PAGE, filtered.length - shown.length)} of {filtered.length - shown.length} remaining)</button>
        </div>
      )}

      {sel && (
        <>
          <div className="scrim" onClick={() => setSel(null)} aria-hidden="true" />
          <aside ref={panelRef} className="drawer" role="dialog" aria-modal="true" aria-label={`Deployment to ${sel.environment}`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <strong style={{ fontSize: 'var(--fs-md)' }}>{sel.environment}</strong>
              <button ref={closeRef} type="button" className="icon-btn" onClick={() => setSel(null)} aria-label="Close deployment details">✕</button>
            </div>
            <table style={{ marginTop: 'var(--space-3)' }}><tbody>
              {field('Status', <><StatusPill status={baseStatus(sel.status)} /> {isRerun(sel.status) && <Chip>rerun</Chip>}</>)}
              {field('Type', sel.deployment_type)}
              {field('Environment', sel.environment)}
              {field('Version', sel.version)}
              {field('FE version', sel.frontend_version)}
              {field('BE version', sel.backend_version)}
              {field('Branch', sel.branch)}
              {field('FE branch', sel.frontend_branch)}
              {field('BE branch', sel.backend_branch)}
              {field('Requested by', sel.requested_by)}
              {field('Approved by', sel.approved_by)}
              {field('Tested by', sel.tested_by)}
              {field('Deployed by', sel.deployed_by)}
              {field('Started', abs(sel.started_at))}
              {field('Completed', abs(sel.completed_at))}
              {field('Duration', dur(sel.duration_seconds))}
              {field('Pull requests', selPrs.length ? <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}><PRChips prs={selPrs} /></span> : null)}
              {field('Run / link', sel.ticket_link ? (isUrl(sel.ticket_link)
                ? <a href={sel.ticket_link} target="_blank" rel="noopener noreferrer" className="key">🔗 {ticketText(sel.ticket_link)} ↗</a> : sel.ticket_link) : null)}
            </tbody></table>
            <h3 className="muted" style={{ fontSize: 'var(--fs-xs)', margin: 'var(--space-4) 0 var(--space-2)' }}>Notes</h3>
            <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 'var(--fs-sm)' }}>{sel.notes ? <Linkified text={sel.notes} /> : <span className="muted">No notes.</span>}</div>
          </aside>
        </>
      )}
    </Card>
  );
}
