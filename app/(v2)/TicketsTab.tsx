'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import AdminGate from './AdminGate';
import { Card, Tile, Pill, Chip, Skeleton, Empty, ErrorNote } from './ui';

// ---- types (mirror lib/jira.ts + app/api/jira/* response shapes) ------------------------------------
interface Issue { key: string; summary: string; status: string; statusCategory: string; type: string; priority: string | null; assignee: string | null; reporter?: string | null; labels?: string[]; created?: string; updated?: string; url: string }
interface Person { id: string; name: string }
interface FilterOptions { people: Person[]; types: string[]; statuses: string[]; priorities: string[]; labels: string[]; components: string[]; versions: string[] }
interface Filters { assignee: string[]; reporter: string[]; type: string[]; priority: string[]; status: string[]; label: string[]; component: string[]; version: string[]; from: string; to: string; q: string }
interface Count { name: string; value: number }
interface Sprint { name: string; goal: string | null; startDate: string | null; endDate: string | null; boardName: string; total: number; byStage: Count[]; byStatus: Count[] }
interface Stats {
  configured: boolean; error?: string; projects?: string[]; windowDays?: number; doneStatuses?: string[];
  totals?: Record<string, number>; byStage?: Count[]; byStatus?: Count[]; byAssignee?: Count[]; assigneeSampled?: number;
  openBugs?: Issue[]; sprints?: Sprint[]; sprintError?: string;
}
interface Deployed { configured: boolean; jiraError?: string; error?: string; tickets: { key: string; environments: Record<string, string> }[]; issues: Record<string, Issue> }
interface Aged extends Issue { ageDays: number | null; createdDays: number | null; environments?: string[]; inProd?: boolean }
interface LT { count: number; medianDays: number; p90Days: number }
interface Insights {
  configured: boolean; error?: string; stuckDays?: number;
  readyToShip?: { total: number; statuses: string[]; shownOldestFirst: number; notInProd: number; items: Aged[] };
  stuck?: { total: number; statuses: string[]; items: Aged[] };
  bugs?: { weekly: { weekStart: string; created: number; closed: number }[]; byPriority: Count[]; byAge: Count[] };
  leadTime?: { overall: LT; byType: Record<string, LT>; createdToProd: LT; windowDays: number; sampled: number };
}
interface NotesItem { id: string; environment: string; branch: string | null; version: string | null; started_at: string; keys: string[] }
interface Explorer { total: number; shown: number; issues: Issue[]; error?: string }
interface Res<T> { data: T | null; error: string | null }
interface Loaded { stats: Res<Stats>; deployed: Res<Deployed>; insights: Res<Insights>; notes: Res<{ deployments?: NotesItem[] }>; explorer: Res<Explorer>; now: number }

// ---- filters <-> query string ---------------------------------------------------------------------
const EMPTY: Filters = { assignee: [], reporter: [], type: [], priority: [], status: [], label: [], component: [], version: [], from: '', to: '', q: '' };
const LISTS = ['assignee', 'reporter', 'type', 'priority', 'status', 'label', 'component', 'version'] as const;
const JF = 'jf'; // single URL param holding the filter query string; other params (tab=…) stay intact
const toQS = (f: Filters) => { const sp = new URLSearchParams(); for (const k of LISTS) if (f[k].length) sp.set(k, f[k].join(',')); if (f.from) sp.set('from', f.from); if (f.to) sp.set('to', f.to); if (f.q.trim()) sp.set('q', f.q.trim()); return sp.toString(); };
const fromQS = (qs: string): Filters => { const sp = new URLSearchParams(qs); const f: Filters = { ...EMPTY, from: sp.get('from') || '', to: sp.get('to') || '', q: sp.get('q') || '' }; for (const k of LISTS) f[k] = (sp.get(k) || '').split(',').filter(Boolean); return f; };
const activeCount = (f: Filters) => LISTS.filter((k) => f[k].length).length + (f.from || f.to ? 1 : 0) + (f.q.trim() ? 1 : 0);
const initialFilters = (): Filters => { try { return fromQS(new URLSearchParams(window.location.search).get(JF) || ''); } catch { return EMPTY; } };

// ---- helpers ----------------------------------------------------------------------------------------
const ENV_ORDER = ['Preview', 'Demo-Preview', 'QA', 'Stage', 'Stage EUW2', 'Pre-Prod', 'Pre-Prod USW', 'Production (Ankura)', 'Production (Neotia/Babyjoy)', 'Production'];
const DAY = 86400000;
const ctl: CSSProperties = { height: 34, minHeight: 34, border: '1px solid var(--border-bright)', background: 'var(--panel)', color: 'var(--text)', borderRadius: 'var(--r-sm)', padding: '0 10px', fontSize: 'var(--fs-sm)', fontFamily: 'inherit' };
const row: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' };
const scroll: CSSProperties = { overflowX: 'auto' };
const subHead: CSSProperties = { fontSize: 'var(--fs-xs)', color: 'var(--muted)', fontWeight: 600, margin: '0 0 6px' };

async function api<T>(url: string): Promise<Res<T>> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    let body: unknown = null;
    try { body = await res.json(); } catch { /* non-JSON body */ }
    if (!res.ok) return { data: null, error: (body as { error?: string } | null)?.error || `HTTP ${res.status}` };
    return { data: body as T, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) };
  }
}

const STATUS_ICON: Record<string, string> = { done: '✓', indeterminate: '●' };
const catColor = (c: string) => (c === 'done' ? 'var(--ok-text)' : c === 'indeterminate' ? 'var(--warn-text)' : 'var(--muted)');
function StatusText({ status, category }: { status: string; category: string }) {
  return <span style={{ color: catColor(category), whiteSpace: 'nowrap' }}><span aria-hidden="true">{STATUS_ICON[category] || '○'}</span> {status}</span>;
}
const idleDays = (iso: string | undefined, now: number) => (iso && now ? Math.max(0, Math.floor((now - new Date(iso).getTime()) / DAY)) : null);
const KeyLink = ({ i }: { i: { key: string; url: string } }) => <a className="key" href={i.url} target="_blank" rel="noopener noreferrer">{i.key}</a>;
const Faint = ({ children }: { children: React.ReactNode }) => <span className="muted">{children}</span>;

function exportCsv(issues: Issue[]) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Key', 'Summary', 'Type', 'Status', 'Priority', 'Assignee', 'Reporter', 'Labels', 'Created', 'Updated', 'URL']]
    .concat(issues.map((i) => [i.key, i.summary, i.type, i.status, i.priority || '', i.assignee || '', i.reporter || '', (i.labels || []).join(' '), i.created || '', i.updated || '', i.url]));
  const blob = new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `jira-tickets-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  URL.revokeObjectURL(a.href);
}

// ---- small components -----------------------------------------------------------------------------
function Bars({ data }: { data: Count[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return <Empty>No data</Empty>;
  return (
    <div>
      {data.slice(0, 10).map((d) => (
        <div key={d.name} style={{ display: 'grid', gridTemplateColumns: 'minmax(80px,150px) 1fr 40px', gap: 8, alignItems: 'center', fontSize: 'var(--fs-xs)', margin: '7px 0' }}>
          <span className="truncate" title={d.name}>{d.name}</span>
          <span className="bar"><span style={{ width: `${(d.value / max) * 100}%` }} /></span>
          <span className="muted tnum" style={{ textAlign: 'right' }}>{d.value}</span>
        </div>
      ))}
    </div>
  );
}

function IssueTable({ issues }: { issues: Issue[] }) {
  return (
    <div style={scroll}>
      <table style={{ minWidth: 640 }}>
        <thead><tr><th>Key</th><th>Summary</th><th>Status</th><th>Priority</th><th>Assignee</th></tr></thead>
        <tbody>
          {issues.map((i) => (
            <tr key={i.key}>
              <td><KeyLink i={i} /></td><td>{i.summary}</td>
              <td><StatusText status={i.status} category={i.statusCategory} /></td>
              <td>{i.priority || '—'}</td><td>{i.assignee || 'Unassigned'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AgedTable({ items, showEnv }: { items: Aged[]; showEnv?: boolean }) {
  return (
    <div style={scroll}>
      <table style={{ minWidth: 700 }}>
        <thead><tr><th>Key</th><th>Summary</th><th>Status</th><th>Assignee</th><th style={{ textAlign: 'center' }}>Idle</th>{showEnv && <th>Deployed to</th>}</tr></thead>
        <tbody>
          {items.map((i) => {
            const d = i.ageDays ?? 0;
            return (
              <tr key={i.key}>
                <td><KeyLink i={i} /></td><td>{i.summary}</td>
                <td><StatusText status={i.status} category={i.statusCategory} /></td>
                <td>{i.assignee || 'Unassigned'}</td>
                <td className="tnum" style={{ textAlign: 'center', fontWeight: d >= 7 ? 700 : 400, color: d >= 14 ? 'var(--bad-text)' : d >= 7 ? 'var(--warn-text)' : 'var(--muted)' }}>{d >= 14 ? '✕ ' : d >= 7 ? '! ' : ''}{i.ageDays ?? '—'}d</td>
                {showEnv && <td>{i.environments && i.environments.length ? <span style={{ color: i.inProd ? 'var(--ok-text)' : 'var(--muted)' }}>{i.inProd ? '✓ ' : ''}{i.environments.join(', ')}</span> : <Faint>not seen</Faint>}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function WeeklyChart({ weeks }: { weeks: { weekStart: string; created: number; closed: number }[] }) {
  const max = Math.max(1, ...weeks.flatMap((w) => [w.created, w.closed]));
  return (
    <div>
      <div className="subtle"><span style={{ color: 'var(--bad)' }} aria-hidden="true">■</span> created &nbsp; <span style={{ color: 'var(--ok)' }} aria-hidden="true">■</span> closed (moved to a done status), per week. Numbers under each week read created/closed.</div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginTop: 8, overflowX: 'auto' }}>
        {weeks.map((w) => (
          <div key={w.weekStart} title={`Week of ${w.weekStart}: ${w.created} created, ${w.closed} closed`} style={{ flex: 1, minWidth: 44, textAlign: 'center' }}>
            <div style={{ height: 110, display: 'flex', gap: 3, alignItems: 'flex-end', justifyContent: 'center' }}>
              <span style={{ display: 'block', width: '40%', maxWidth: 22, minHeight: 1, borderRadius: '3px 3px 0 0', height: `${(w.created / max) * 100}%`, background: 'var(--bad)' }} />
              <span style={{ display: 'block', width: '40%', maxWidth: 22, minHeight: 1, borderRadius: '3px 3px 0 0', height: `${(w.closed / max) * 100}%`, background: 'var(--ok)' }} />
            </div>
            <div className="subtle" style={{ marginTop: 4 }}>{w.weekStart.slice(5)}</div>
            <div className="subtle tnum">{w.created}/{w.closed}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LTTile({ label, lt }: { label: string; lt: LT }) {
  return <Tile label={label} value={lt.count ? `${lt.medianDays}d` : '—'} hint={lt.count ? `median · p90 ${lt.p90Days}d · n=${lt.count}` : 'no data'} />;
}

function MultiSelect({ label, options, value, onChange }: { label: string; options: { id: string; name: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const shown = options.filter((o) => o.name.toLowerCase().includes(q.toLowerCase())).slice(0, 200);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const names = value.map((v) => options.find((o) => o.id === v)?.name || v);
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" className="btn" aria-expanded={open} aria-haspopup="listbox" style={{ height: 34, borderColor: value.length ? 'var(--accent)' : undefined }} title={names.join(', ')} onClick={() => setOpen(!open)}>
        {label}{value.length ? `: ${value.length === 1 ? names[0] : `${value.length} selected`}` : ''} ▾
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 29 }} onClick={() => setOpen(false)} />
          <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 30, width: 'min(260px, 86vw)', background: 'var(--panel)', border: '1px solid var(--border-bright)', borderRadius: 'var(--r-md)', padding: 8, boxShadow: 'var(--elev-2)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input type="text" aria-label={`Search ${label.toLowerCase()}`} placeholder={`Search ${label.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} autoFocus style={{ ...ctl, minWidth: 0, width: '100%' }} />
            <div style={{ maxHeight: 240, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
              {shown.length === 0 && <div className="subtle" style={{ padding: 6 }}>{options.length ? 'No match' : 'Loading…'}</div>}
              {shown.map((o) => (
                <label key={o.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 6px', fontSize: 'var(--fs-sm)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={value.includes(o.id)} onChange={() => toggle(o.id)} /> {o.name}
                </label>
              ))}
            </div>
            {value.length > 0 && <button type="button" className="btn" style={{ height: 34 }} onClick={() => onChange([])}>Clear {label.toLowerCase()}</button>}
          </div>
        </>
      )}
    </div>
  );
}

// ---- main -------------------------------------------------------------------------------------------
export default function TicketsTab() {
  return <AdminGate title="Tickets (Jira)"><Tickets /></AdminGate>;
}

function Tickets() {
  const [days, setDays] = useState(30);
  const [stuckDays, setStuckDays] = useState(5);
  const [sort, setSort] = useState('updated');
  const [filters, setFilters] = useState<Filters>(initialFilters); // what the bar shows
  const [applied, setApplied] = useState<Filters>(initialFilters); // what the dashboard is loaded with
  const [options, setOptions] = useState<FilterOptions | null>(null);
  const [optionsErr, setOptionsErr] = useState<string | null>(null);
  const [res, setRes] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [notesId, setNotesId] = useState('');
  const [notesMd, setNotesMd] = useState('');
  const [notesErr, setNotesErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async (fresh = false) => {
    const mine = ++seq.current;
    const qs = toQS(applied);
    const f = (fresh ? '&fresh=1' : '') + (qs ? `&${qs}` : '');
    const [stats, deployed, insights, notes, explorer] = await Promise.all([
      api<Stats>(`/api/jira/stats?days=${days}${f}`),
      api<Deployed>('/api/jira/deployed'),
      api<Insights>(`/api/jira/insights?stuckDays=${stuckDays}${f}`),
      api<{ deployments?: NotesItem[] }>('/api/jira/release-notes'),
      api<Explorer>(`/api/jira/search?sort=${sort}${f}`),
    ]);
    if (mine !== seq.current) return; // a newer load superseded this one
    setRes({ stats, deployed, insights, notes, explorer, now: Date.now() });
    setLoading(false);
  }, [days, stuckDays, applied, sort]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let alive = true;
    void api<FilterOptions & { error?: string }>('/api/jira/filters').then((r) => {
      if (!alive) return;
      if (r.error) setOptionsErr(r.error);
      else if (r.data?.people) setOptions(r.data);
    });
    return () => { alive = false; };
  }, []);

  const apply = (f: Filters) => {
    if (f !== applied) setLoading(true); // same object => no state change => no reload
    setFilters(f); setApplied(f);
    try {
      const url = new URL(window.location.href);
      const qs = toQS(f);
      if (qs) url.searchParams.set(JF, qs); else url.searchParams.delete(JF);
      window.history.replaceState(null, '', url);
    } catch { /* URL sync is best effort */ }
  };
  const iso = (d: number) => new Date(Date.now() - d * DAY).toISOString().slice(0, 10);

  const loadNotes = async (id: string) => {
    setNotesId(id); setNotesMd(''); setCopied(false); setNotesErr(null);
    if (!id) return;
    const r = await api<{ markdown?: string }>(`/api/jira/release-notes?id=${encodeURIComponent(id)}`);
    if (r.error) setNotesErr(r.error); else setNotesMd(r.data?.markdown || 'No release notes for this deployment.');
  };
  const copyNotes = async () => { try { await navigator.clipboard.writeText(notesMd); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setNotesErr('Copy failed. Select the text and copy it manually.'); } };

  const stats = res?.stats.data;
  const insights = res?.insights.data;
  const deployed = res?.deployed.data;
  const explorer = res?.explorer.data;
  const notesList = res?.notes.data?.deployments || [];
  const now = res?.now || 0;
  const t = stats?.totals;
  const notConfigured = stats?.configured === false;
  const envs = deployed
    ? ENV_ORDER.filter((e) => deployed.tickets.some((x) => x.environments[e])).concat([...new Set(deployed.tickets.flatMap((x) => Object.keys(x.environments)))].filter((e) => !ENV_ORDER.includes(e)))
    : [];
  const people = options?.people || [];
  const opt = (xs?: string[]) => (xs || []).map((x) => ({ id: x, name: x }));
  const set = (k: keyof Filters) => (v: string[]) => setFilters({ ...filters, [k]: v });
  const nApplied = activeCount(applied);
  const autoGrid = (min: number): CSSProperties => ({ display: 'grid', gap: 'var(--space-4)', gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}px, 100%), 1fr))` });

  return (
    <div className="stack" style={{ marginTop: 0 }}>
      <div style={{ ...row, justifyContent: 'space-between' }}>
        <div className="subtle">Delivery tickets and what has shipped to each environment{stats?.projects ? ` · ${stats.projects.join(', ')}` : ''}</div>
        <div style={row}>
          <select style={ctl} value={days} onChange={(e) => { setLoading(true); setDays(Number(e.target.value)); }} aria-label="Window">
            {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>Last {d} days</option>)}
          </select>
          <select style={ctl} value={stuckDays} onChange={(e) => { setLoading(true); setStuckDays(Number(e.target.value)); }} aria-label="Stuck threshold">
            {[3, 5, 7, 14, 30].map((d) => <option key={d} value={d}>Stuck ≥ {d}d</option>)}
          </select>
          <button type="button" className="btn" style={{ height: 34 }} onClick={() => { setLoading(true); void load(true); }} disabled={loading}>{loading ? 'Loading…' : '↺ Refresh'}</button>
        </div>
      </div>

      <section aria-label="Filters" style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 'var(--pad-card)', position: 'relative', zIndex: 5, display: 'grid', gap: 8 }}>
        {optionsErr && <ErrorNote>Filter options: {optionsErr}</ErrorNote>}
        <div style={row}>
          <MultiSelect label="Assignee" options={[{ id: 'unassigned', name: 'Unassigned' }, ...people]} value={filters.assignee} onChange={set('assignee')} />
          <MultiSelect label="Reported by" options={people} value={filters.reporter} onChange={set('reporter')} />
          <MultiSelect label="Type" options={opt(options?.types)} value={filters.type} onChange={set('type')} />
          <MultiSelect label="Priority" options={opt(options?.priorities)} value={filters.priority} onChange={set('priority')} />
          <MultiSelect label="Status" options={opt(options?.statuses)} value={filters.status} onChange={set('status')} />
          <MultiSelect label="Label" options={opt(options?.labels)} value={filters.label} onChange={set('label')} />
          <MultiSelect label="Component" options={opt(options?.components)} value={filters.component} onChange={set('component')} />
          <MultiSelect label="Fix version" options={opt(options?.versions)} value={filters.version} onChange={set('version')} />
        </div>
        <div style={row}>
          <label className="muted" style={{ ...row, flexWrap: 'nowrap', fontSize: 'var(--fs-xs)' }}>Created from <input type="date" style={ctl} value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></label>
          <label className="muted" style={{ ...row, flexWrap: 'nowrap', fontSize: 'var(--fs-xs)' }}>to <input type="date" style={ctl} value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></label>
          <input type="text" aria-label="Search text" placeholder="Search text (summary, description, comments)…" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && apply(filters)} style={{ ...ctl, flex: '1 1 220px', minWidth: 0 }} />
          <button type="button" className="btn" aria-pressed="true" style={{ height: 34 }} onClick={() => apply(filters)}>Apply filters</button>
          <button type="button" className="btn" style={{ height: 34 }} onClick={() => apply(EMPTY)} disabled={activeCount(filters) === 0 && nApplied === 0}>Clear</button>
        </div>
        <div style={row}>
          <span className="subtle">Quick:</span>
          <button type="button" className="btn" style={{ height: 34 }} onClick={() => apply({ ...EMPTY, type: ['Bug'] })}>Bugs</button>
          <button type="button" className="btn" style={{ height: 34 }} onClick={() => apply({ ...EMPTY, assignee: ['unassigned'] })}>Unassigned</button>
          <button type="button" className="btn" style={{ height: 34 }} onClick={() => apply({ ...EMPTY, from: iso(7) })}>Created last 7d</button>
          <button type="button" className="btn" style={{ height: 34 }} onClick={() => apply({ ...EMPTY, type: ['Bug'], from: iso(7) })}>New bugs (7d)</button>
          <button type="button" className="btn" style={{ height: 34 }} onClick={() => apply({ ...EMPTY, type: ['Bug'], priority: ['Highest', 'High'] })}>High-priority bugs</button>
          {nApplied > 0 && <span className="subtle">· {nApplied} filter{nApplied === 1 ? '' : 's'} applied to every section below (sprint panel and tickets-by-environment are not filtered)</span>}
        </div>
      </section>

      {loading && !res && <Skeleton rows={5} />}

      {notConfigured && (
        <Card title="Jira is not configured">
          <p className="muted" style={{ marginTop: 0 }}>Add these Vercel environment variables (Production) and redeploy:</p>
          <pre style={{ background: 'var(--panel-2)', padding: 12, borderRadius: 'var(--r-sm)', overflowX: 'auto', fontSize: 'var(--fs-xs)', margin: 0 }}>{`JIRA_BASE_URL=https://<your-site>.atlassian.net
JIRA_EMAIL=<atlassian account email>
JIRA_API_TOKEN=<API token>
JIRA_PROJECT_KEYS=CORE,EMR   # comma separated`}</pre>
        </Card>
      )}

      {res?.stats.error && <ErrorNote>Metrics: {res.stats.error}</ErrorNote>}
      {stats?.configured && stats.error && <ErrorNote>Metrics: {stats.error}</ErrorNote>}

      {t && stats && (
        <>
          <div style={autoGrid(150)}>
            {([['Open', t.open], ['In development', t.inDevelopment], ['Review + QA + passed', t.inQA], ['Open bugs', t.openBugs],
              ['Created 7d', t.createdLast7d], ['Done 7d', t.doneLast7d], [`Created ${days}d`, t.createdInWindow], [`Done ${days}d`, t.doneInWindow], [`Released to prod ${days}d`, t.releasedInWindow]] as [string, number | undefined][]).map(([l, v]) => (
              <Tile key={l} label={l} value={v ?? '—'} />
            ))}
          </div>
          <div className="subtle">Counts cover all issues in {stats.projects?.join(', ')}. “Done” = moved into {stats.doneStatuses?.length ? stats.doneStatuses.join(', ') : 'a resolved state'} within the window (override with <code>JIRA_DONE_STATUSES</code>).</div>

          {(stats.sprints || []).map((sp) => {
            const left = sp.endDate && now ? Math.ceil((new Date(sp.endDate).getTime() - now) / DAY) : null;
            return (
              <Card key={sp.name} title={`Active sprint · ${sp.name} (${sp.boardName})`}>
                <div className="subtle" style={{ marginBottom: 8 }}>
                  {sp.startDate && new Date(sp.startDate).toLocaleDateString()} → {sp.endDate && new Date(sp.endDate).toLocaleDateString()}
                  {left !== null && ` · ${left >= 0 ? `${left} day${left === 1 ? '' : 's'} left` : `ended ${-left} day(s) ago`}`} · {sp.total} issues
                  {sp.goal ? ` · Goal: ${sp.goal}` : ''}
                </div>
                <div style={autoGrid(280)}>
                  <div><h3 style={subHead}>By stage</h3><Bars data={sp.byStage} /></div>
                  <div><h3 style={subHead}>By status</h3><Bars data={sp.byStatus} /></div>
                </div>
              </Card>
            );
          })}
          {stats.sprintError && <div className="subtle">Sprint data unavailable: {stats.sprintError}</div>}

          <div style={autoGrid(280)}>
            <Card title="By stage (all issues)"><Bars data={stats.byStage || []} /></Card>
            <Card title="By status (all)"><Bars data={stats.byStatus || []} /></Card>
            <Card title={`Open by assignee (latest ${stats.assigneeSampled ?? 0} updated)`}><Bars data={stats.byAssignee || []} /></Card>
          </div>

          <Card title="Open bugs">
            {stats.openBugs && stats.openBugs.length ? <IssueTable issues={stats.openBugs} /> : <Empty>No open bugs.</Empty>}
          </Card>
        </>
      )}

      {res?.insights.error && <ErrorNote>Insights: {res.insights.error}</ErrorNote>}
      {insights?.error && <ErrorNote>Insights: {insights.error}</ErrorNote>}

      {insights?.readyToShip && (
        <Card title={`Ready to ship · ${insights.readyToShip.total} in ${insights.readyToShip.statuses.join(', ') || 'QA Passed'}`}>
          <div className="subtle" style={{ marginBottom: 8 }}>Oldest first (showing {insights.readyToShip.shownOldestFirst}). {insights.readyToShip.notInProd} of these have not been seen in a Production deployment. “Idle” = days since the ticket was last updated.</div>
          <AgedTable items={insights.readyToShip.items} showEnv />
        </Card>
      )}

      {insights?.stuck && (
        <Card title={`Stuck tickets · ${insights.stuck.total} idle ≥ ${insights.stuckDays} days`}>
          <div className="subtle" style={{ marginBottom: 8 }}>In {insights.stuck.statuses.join(', ')} with no update for {insights.stuckDays}+ days (oldest first, top 40).</div>
          {insights.stuck.items.length ? <AgedTable items={insights.stuck.items} /> : <Empty>Nothing stuck.</Empty>}
        </Card>
      )}

      {insights?.bugs && (
        <Card title="Bug trends">
          <WeeklyChart weeks={insights.bugs.weekly} />
          <div style={{ ...autoGrid(280), marginTop: 14 }}>
            <div><h3 style={subHead}>Open bugs by priority</h3><Bars data={insights.bugs.byPriority} /></div>
            <div><h3 style={subHead}>Open bugs by age</h3><Bars data={insights.bugs.byAge} /></div>
          </div>
        </Card>
      )}

      {insights?.leadTime && (
        <Card title="Lead time">
          <div className="subtle" style={{ marginBottom: 8 }}>Tasks/stories/bugs done in the last {insights.leadTime.windowDays} days, {insights.leadTime.sampled} sampled; sub-tasks and epics excluded.</div>
          <div style={autoGrid(150)}>
            <LTTile label="Created → done (all)" lt={insights.leadTime.overall} />
            {Object.entries(insights.leadTime.byType).filter(([, v]) => v.count >= 3).slice(0, 4).map(([k, v]) => <LTTile key={k} label={k} lt={v} />)}
            <LTTile label="Created → first prod deploy" lt={insights.leadTime.createdToProd} />
          </div>
        </Card>
      )}

      <Card title="Release notes">
        <div className="subtle" style={{ marginBottom: 8 }}>Pick a deployment that references Jira tickets; copy the markdown into release notes or chat.</div>
        {res?.notes.error && <ErrorNote>Release notes: {res.notes.error}</ErrorNote>}
        <select style={{ ...ctl, maxWidth: '100%' }} aria-label="Deployment" value={notesId} onChange={(e) => void loadNotes(e.target.value)}>
          <option value="">Select a deployment…</option>
          {notesList.map((n) => <option key={n.id} value={n.id}>{n.environment} · {new Date(n.started_at).toLocaleString()} · {n.keys.join(', ')}</option>)}
        </select>
        {notesErr && <div style={{ marginTop: 8 }}><ErrorNote>{notesErr}</ErrorNote></div>}
        {notesMd && (
          <div style={{ marginTop: 8 }}>
            <pre style={{ background: 'var(--panel-2)', padding: 12, borderRadius: 'var(--r-sm)', overflow: 'auto', maxHeight: 360, fontSize: 'var(--fs-xs)', margin: '0 0 8px' }}>{notesMd}</pre>
            <button type="button" className="btn" style={{ height: 34 }} onClick={() => void copyNotes()}>{copied ? 'Copied ✓' : 'Copy markdown'}</button>
          </div>
        )}
        {res && !res.notes.error && notesList.length === 0 && <Empty>No deployments with Jira keys yet. They appear once deploys carry <code>Jira: VID-123</code> in their notes.</Empty>}
      </Card>

      {res?.explorer.error && <ErrorNote>Tickets: {res.explorer.error}</ErrorNote>}
      {explorer && (
        <Card title="Tickets" action={explorer.total !== undefined ? <Chip>{explorer.total} match{explorer.total === 1 ? '' : 'es'}{explorer.shown < explorer.total ? ` (showing ${explorer.shown})` : ''}</Chip> : undefined}>
          {explorer.error && <ErrorNote>{explorer.error}</ErrorNote>}
          <div style={{ ...row, marginBottom: 8 }}>
            <select style={ctl} value={sort} onChange={(e) => { setLoading(true); setSort(e.target.value); }} aria-label="Sort">
              <option value="updated">Recently updated</option><option value="created">Newest first</option><option value="oldest">Oldest first</option>
              <option value="priority">Priority</option><option value="idle">Longest idle</option>
            </select>
            <button type="button" className="btn" style={{ height: 34 }} onClick={() => exportCsv(explorer.issues)} disabled={!explorer.issues?.length}>Export CSV</button>
          </div>
          {explorer.issues?.length ? (
            <div style={scroll}>
              <table style={{ minWidth: 960 }}>
                <thead><tr><th>Key</th><th>Summary</th><th>Type</th><th>Status</th><th>Priority</th><th>Assignee</th><th>Reporter</th><th>Labels</th><th>Created</th><th style={{ textAlign: 'center' }}>Idle</th></tr></thead>
                <tbody>
                  {explorer.issues.map((i) => (
                    <tr key={i.key}>
                      <td><KeyLink i={i} /></td><td>{i.summary}</td><td>{i.type}</td>
                      <td><StatusText status={i.status} category={i.statusCategory} /></td>
                      <td>{i.priority || '—'}</td>
                      <td>{i.assignee || <Faint>Unassigned</Faint>}</td>
                      <td>{i.reporter || '—'}</td>
                      <td className="muted">{(i.labels || []).join(', ')}</td>
                      <td className="muted" style={{ whiteSpace: 'nowrap' }}>{i.created ? new Date(i.created).toLocaleDateString() : '—'}</td>
                      <td className="muted tnum" style={{ textAlign: 'center' }}>{idleDays(i.updated, now) ?? '—'}d</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : !explorer.error && <Empty>No tickets match these filters.</Empty>}
        </Card>
      )}

      {res?.deployed.error && <ErrorNote>Tickets by environment: {res.deployed.error}</ErrorNote>}
      {deployed && (
        <Card title="Tickets by environment">
          <div className="subtle" style={{ marginBottom: 8 }}>Jira keys found in notes, branches, versions and ticket links of the last 300 successful deployments. ✓ = deployed there.</div>
          {deployed.error && <ErrorNote>{deployed.error}</ErrorNote>}
          {deployed.jiraError && <ErrorNote>Jira lookup failed: {deployed.jiraError}</ErrorNote>}
          {deployed.tickets.length === 0 ? <Empty>No Jira keys found in recent deployments.</Empty> : (
            <div style={scroll}>
              <table style={{ minWidth: 640 }}>
                <thead><tr><th>Ticket</th><th>Summary</th><th>Status</th>{envs.map((e) => <th key={e} style={{ textAlign: 'center' }}>{e}</th>)}</tr></thead>
                <tbody>
                  {deployed.tickets.map(({ key, environments }) => {
                    const i = deployed.issues[key];
                    return (
                      <tr key={key}>
                        <td>{i ? <KeyLink i={i} /> : <span className="key">{key}</span>}</td>
                        <td>{i?.summary || <Faint>—</Faint>}</td>
                        <td>{i ? <StatusText status={i.status} category={i.statusCategory} /> : '—'}</td>
                        {envs.map((e) => (
                          <td key={e} style={{ textAlign: 'center', color: 'var(--ok-text)', fontWeight: 700 }} title={environments[e] ? new Date(environments[e]).toLocaleString() : ''}>
                            {environments[e] ? <><span aria-hidden="true">✓</span><span className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>deployed</span></> : ''}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      {!res && !loading && <Pill tone="neutral">No data</Pill>}
    </div>
  );
}
