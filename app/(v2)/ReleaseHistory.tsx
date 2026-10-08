'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useShell } from './ctx';
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

const IGNORE = new Set(['UTF', 'SHA', 'ISO', 'HTTP', 'AES', 'RSA', 'TLS', 'SSL', 'FE', 'BE', 'ECS', 'EC', 'PR']);
const STATUSES = ['Success', 'In Progress', 'Failed', 'Rolled Back', 'Cancelled'];
const PAGE = 25;

const isRerun = (s: string) => /^rerun\s*-/i.test(s);
const baseStatus = (s: string) => s.replace(/^rerun\s*-\s*/i, '').trim();
const isProd = (e: string) => /^production/i.test(e);

function keysOf(r: Row): string[] {
  const text = [r.notes, r.branch, r.frontend_branch, r.backend_branch, r.version].filter(Boolean).join(' ');
  const out: string[] = [];
  for (const m of text.matchAll(/\b([A-Z][A-Z0-9]{1,9})-(\d{1,6})\b/g)) {
    if (IGNORE.has(m[1])) continue;
    if (!out.includes(m[0])) out.push(m[0]);
  }
  return out;
}

function dur(sec?: number | null): string {
  if (sec == null) return '—';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}
const abs = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

function Versions({ r }: { r: Row }) {
  if (r.frontend_version || r.backend_version) {
    return (
      <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
        {r.frontend_version && <Chip title="Frontend version">FE {r.frontend_version}</Chip>}
        {r.backend_version && <Chip title="Backend version">BE {r.backend_version}</Chip>}
      </span>
    );
  }
  return r.version ? <Chip>{r.version}</Chip> : <span className="muted">—</span>;
}

export default function ReleaseHistory() {
  const { setOpenTicket } = useShell();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [env, setEnv] = useState('');
  const [status, setStatus] = useState('');
  const [prodOnly, setProdOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [sel, setSel] = useState<Row | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch('/api/deployments?limit=500', { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as Row[];
        if (alive) { setRows(Array.isArray(j) ? j : []); setError(null); }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load');
      }
    };
    load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 90_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const sorted = useMemo(() => (rows ?? []).slice().sort((a, b) => +new Date(b.started_at) - +new Date(a.started_at)), [rows]);
  const envs = useMemo(() => [...new Set(sorted.map((r) => r.environment))].sort(), [sorted]);
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return sorted.filter((r) => {
      if (env && r.environment !== env) return false;
      if (status && baseStatus(r.status) !== status) return false;
      if (prodOnly && !isProd(r.environment)) return false;
      if (!n) return true;
      const hay = [r.version, r.frontend_version, r.backend_version, r.branch, r.frontend_branch, r.backend_branch,
        r.requested_by, r.approved_by, r.tested_by, r.deployed_by, r.notes, ...keysOf(r)].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(n);
    });
  }, [sorted, q, env, status, prodOnly]);
  const shown = filtered.slice(0, limit);

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
  const keyBtn = (k: string, fromDrawer = false) => (
    <button key={k} type="button" className="key" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
      onClick={(e) => { e.stopPropagation(); if (fromDrawer) setSel(null); setOpenTicket(k); }}>{k}</button>
  );
  const ctl = { fontSize: 'var(--fs-sm)', minHeight: 32 } as const;
  const selectStyle = { ...ctl, border: '1px solid var(--border-bright)', background: 'var(--panel)', color: 'var(--text)', borderRadius: 'var(--r-sm)', padding: '4px 8px' };

  const field = (label: string, v: React.ReactNode) => (
    <tr><td className="muted">{label}</td><td style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{v ?? '—'}</td></tr>
  );
  const sk = sel ? keysOf(sel) : [];
  const link = sel?.ticket_link && /^https?:\/\//i.test(sel.ticket_link) ? sel.ticket_link : null;

  return (
    <Card title="Deployment history">
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
        <input type="search" aria-label="Search deployments" placeholder="Search version, branch, person, notes, ticket" value={q}
          onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} />
        <select aria-label="Filter by environment" style={selectStyle} value={env} onChange={(e) => { setEnv(e.target.value); setLimit(PAGE); }}>
          <option value="">All environments</option>
          {envs.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <select aria-label="Filter by status" style={selectStyle} value={status} onChange={(e) => { setStatus(e.target.value); setLimit(PAGE); }}>
          <option value="">All statuses</option>
          {STATUSES.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <button type="button" className="btn" aria-pressed={prodOnly} aria-label="Production only" onClick={() => { setProdOnly((v) => !v); setLimit(PAGE); }}>Production only</button>
        {rows && <span className="muted" role="status" style={{ fontSize: 'var(--fs-sm)' }}>Showing {filtered.length} of {rows.length}</span>}
      </div>

      {error && <ErrorNote>Could not load deployment history ({error}).{rows ? ' Showing last loaded data.' : ''}</ErrorNote>}
      {!rows && !error && <Skeleton rows={6} />}
      {rows && filtered.length === 0 && <Empty>No deployments match these filters.</Empty>}
      {shown.length > 0 && (
        <table>
          <thead><tr><th>When</th><th>Environment</th><th>Status</th><th>Version</th><th>Branch</th><th>By</th><th>Duration</th><th>Tickets</th></tr></thead>
          <tbody>
            {shown.map((r) => {
              const ks = keysOf(r);
              return (
                <tr key={r.id} className="click" onClick={(e) => open(r, e.currentTarget.querySelector('button'))}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button type="button" title={abs(r.started_at)} aria-label={`Open details for ${r.environment} deployment, ${abs(r.started_at)}`}
                      style={{ background: 'none', border: 0, padding: 0, color: 'inherit', font: 'inherit', cursor: 'pointer' }}
                      onClick={(e) => { e.stopPropagation(); open(r, e.currentTarget); }}>{ago(r.started_at)}</button>
                  </td>
                  <td>{r.environment} {isProd(r.environment) && <Chip>PROD</Chip>}</td>
                  <td><StatusPill status={baseStatus(r.status)} /> {isRerun(r.status) && <Chip>rerun</Chip>}</td>
                  <td><Versions r={r} /></td>
                  <td>{r.branch || r.backend_branch || r.frontend_branch || <span className="muted">—</span>}</td>
                  <td>{r.deployed_by || r.requested_by || <span className="muted">—</span>}</td>
                  <td className="tnum">{dur(r.duration_seconds)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {ks.length === 0 ? <span className="muted">—</span> : <>
                      <span style={{ display: 'inline-flex', gap: 8 }}>{ks.slice(0, 2).map((k) => keyBtn(k))}</span>
                      {ks.length > 2 && <span className="muted"> +{ks.length - 2} more</span>}
                    </>}
                  </td>
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
              {field('Tickets', sk.length ? <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>{sk.map((k) => keyBtn(k, true))}</span> : null)}
              {field('Run', link ? <a href={link} target="_blank" rel="noreferrer" className="key">Open run ↗</a> : null)}
            </tbody></table>
            <h3 className="muted" style={{ fontSize: 'var(--fs-xs)', margin: 'var(--space-4) 0 var(--space-2)' }}>Notes</h3>
            <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 'var(--fs-sm)' }}>{sel.notes || <span className="muted">No notes.</span>}</div>
          </aside>
        </>
      )}
    </Card>
  );
}
