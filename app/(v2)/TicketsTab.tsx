'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import AdminGate from './AdminGate';
import { Card, Tile, Skeleton, Empty, ErrorNote, fmtDate, fmtDateTime } from './ui';
import { BugFlowChart, PriorityBars, AgeBuckets, StageBars, Sparkline, Delta } from './tickets/Charts';
import RecentBugs from './tickets/RecentBugs';
import ActivityLog from './tickets/ActivityLog';
import QualityPanel from './tickets/QualityPanel';
import type { BugsResponse, DayPoint } from '@/lib/tickets-types';

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


// ---- layout helpers ---------------------------------------------------------------------------------
const b34: CSSProperties = { height: 34 };
const CSS = `
.v2 .tkt-sum { list-style: none; cursor: pointer; min-height: 34px; align-items: center; margin: 0; user-select: none; }
.v2 .tkt-sum::-webkit-details-marker { display: none; }
.v2 .tkt-sum:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; border-radius: var(--r-xs); }
.v2 .tkt-caret { display: inline-block; width: 14px; transition: transform var(--dur-fast); }
.v2 details[open] > .tkt-sum .tkt-caret { transform: rotate(90deg); }
.v2 .tkt-body { margin-top: var(--space-3); }
.v2 .tkt-graphs { display: grid; gap: var(--space-4); grid-template-columns: minmax(0, 1fr); }
.v2 .tkt-side { display: grid; gap: var(--space-4); align-content: start; }
.v2 .tkt-two { display: grid; gap: var(--space-4); grid-template-columns: minmax(0, 1fr); align-items: start; }
@media (min-width: 1100px) {
  .v2 .tkt-graphs { grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); grid-template-areas: 'flow side' 'stage side'; }
  .v2 .tkt-wide { grid-area: flow; }
  .v2 .tkt-side { grid-area: side; }
  .v2 .tkt-stage { grid-area: stage; }
  .v2 .tkt-two { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) { .v2 .tkt-caret { transition: none; } }
`;

// Native disclosure; open state is remembered per section in localStorage (read after mount).
function Section({ id, title, meta, defaultOpen = false, children }: { id: string; title: string; meta?: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const ready = useRef(false);
  useEffect(() => {
    const t = setTimeout(() => {
      try { const v = localStorage.getItem(`tickets-open-${id}`); if (v === '1' || v === '0') setOpen(v === '1'); } catch { /* storage blocked */ }
      ready.current = true;
    }, 0);
    return () => clearTimeout(t);
  }, [id]);
  return (
    <details className="panel-quiet" open={open} onToggle={(e) => {
      const o = e.currentTarget.open;
      if (!ready.current || o === open) return;
      setOpen(o);
      try { localStorage.setItem(`tickets-open-${id}`, o ? '1' : '0'); } catch { /* storage blocked */ }
    }}>
      <summary className="section-h tkt-sum">
        <span><span className="tkt-caret" aria-hidden="true">▸</span><h2 style={{ display: 'inline' }}>{title}</h2></span>
        {meta != null && <span className="meta">{meta}</span>}
      </summary>
      <div className="tkt-body">{children}</div>
    </details>
  );
}

function Stat({ label, value, hint, first, extra }: { label: string; value: React.ReactNode; hint?: React.ReactNode; first?: boolean; extra?: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0, paddingLeft: first ? 0 : 12, borderLeft: first ? 'none' : '1px solid var(--border)' }}>
      <div className="subtle" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={typeof label === 'string' ? label : undefined}>{label}</div>
      <div className="tnum" style={{ fontSize: 22, lineHeight: '30px', fontWeight: 700, fontFamily: 'var(--font-data)' }}>{value}</div>
      {extra && <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 28 }}>{extra}</div>}
      {hint != null && <div className="subtle">{hint}</div>}
    </div>
  );
}

const sumOf = (s: DayPoint[], k: 'created' | 'resolved') => s.reduce((a, d) => a + d[k], 0);

// Compact "Ticket pulse": existing KPI numbers as divider-separated stat blocks + trend extras.
function Pulse({ stats, bugs, days }: { stats: Stats; bugs: BugsResponse | null; days: number }) {
  const t = stats.totals || {};
  const bs = bugs?.bugSeries || [];
  const is = bugs?.issueSeries || [];
  const two = (s: DayPoint[], k: 'created' | 'resolved') => (s.length >= 14 ? { now: sumOf(s.slice(-7), k), before: sumOf(s.slice(-14, -7), k) } : null);
  const bugD = two(bs, 'created'), cD = two(is, 'created'), dD = two(is, 'resolved');
  const v = (n: number | undefined) => n ?? '—';
  return (
    <Card title="Ticket pulse">
      <div role="group" aria-label="Ticket counts" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(128px, 1fr))', rowGap: 14, columnGap: 8 }}>
        <Stat first label="Open" value={v(t.open)} hint="all issues" />
        <Stat label="In development" value={v(t.inDevelopment)} />
        <Stat label="Review + QA + passed" value={v(t.inQA)} />
        <Stat label="Open bugs" value={bugs ? bugs.open.total : v(t.openBugs)} hint={bugs ? (bugs.truncated ? 'before QA passed (partial)' : 'before QA passed') : undefined} />
        <Stat label="Bugs raised 7d" value={bugD ? bugD.now : '—'} hint={bs.length ? `last ${bs.length} days` : 'no bug data'}
          extra={bs.length ? <><Sparkline values={bs.map((d) => d.created)} label={`Bugs raised per day, last ${bs.length} days`} />{bugD && <Delta now={bugD.now} before={bugD.before} goodWhen="down" />}</> : undefined} />
        <Stat label="Created 7d" value={v(t.createdLast7d)} extra={cD ? <Delta now={cD.now} before={cD.before} goodWhen="up" /> : undefined} hint={cD ? 'vs previous 7d' : undefined} />
        <Stat label="Resolved 7d" value={dD ? dD.now : v(t.doneLast7d)} extra={dD ? <Delta now={dD.now} before={dD.before} goodWhen="up" /> : undefined} hint={dD ? 'QA passed or later · vs previous 7d' : 'done'} />
        <Stat label={`Created ${days}d`} value={v(t.createdInWindow)} />
        <Stat label={`Done ${days}d`} value={v(t.doneInWindow)} />
        <Stat label={`Released to prod ${days}d`} value={v(t.releasedInWindow)} />
      </div>
      <div className="subtle" style={{ marginTop: 12 }}>Counts cover all issues in {stats.projects?.join(', ')}. “Done” = moved into {stats.doneStatuses?.length ? stats.doneStatuses.join(', ') : 'a resolved state'} within the window (override with <code>JIRA_DONE_STATUSES</code>).</div>
    </Card>
  );
}

// ---- main -------------------------------------------------------------------------------------------
export default function TicketsTab() {
  return <AdminGate title="Tickets (Jira)" publicUrl="/api/jira/access"><Tickets /></AdminGate>;
}

function Tickets() {
  const [days, setDays] = useState(30);
  const [bugDays, setBugDays] = useState(30);
  const [stuckDays, setStuckDays] = useState(5);
  const [sort, setSort] = useState('updated');
  const [filters, setFilters] = useState<Filters>(initialFilters); // what the bar shows
  const [applied, setApplied] = useState<Filters>(initialFilters); // what the dashboard is loaded with
  const [filtersOpen, setFiltersOpen] = useState(() => activeCount(initialFilters()) > 0);
  const [options, setOptions] = useState<FilterOptions | null>(null);
  const [optionsErr, setOptionsErr] = useState<string | null>(null);
  const [res, setRes] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [bugs, setBugs] = useState<Res<BugsResponse> | null>(null);
  const [tick, setTick] = useState(0); // bumps on refresh so the self-fetching ActivityLog reloads
  const [notesId, setNotesId] = useState('');
  const [notesMd, setNotesMd] = useState('');
  const [notesErr, setNotesErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const seq = useRef(0);
  const bugSeq = useRef(0);

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

  const loadBugs = useCallback(async () => {
    const mine = ++bugSeq.current;
    const r = await api<BugsResponse>(`/api/jira/bugs?days=${bugDays}`);
    if (mine !== bugSeq.current) return;
    setBugs(r);
  }, [bugDays]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadBugs(); }, [loadBugs]);
  useEffect(() => {
    const on = () => { setTick((n) => n + 1); void loadBugs(); };
    window.addEventListener('tracker:refresh', on);
    window.addEventListener('tracker:auth-changed', on);
    return () => { window.removeEventListener('tracker:refresh', on); window.removeEventListener('tracker:auth-changed', on); };
  }, [loadBugs]);

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
  const refresh = () => { setLoading(true); setTick((n) => n + 1); void load(true); void loadBugs(); };

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
  const notConfigured = stats?.configured === false;
  const envs = deployed
    ? ENV_ORDER.filter((e) => deployed.tickets.some((x) => x.environments[e])).concat([...new Set(deployed.tickets.flatMap((x) => Object.keys(x.environments)))].filter((e) => !ENV_ORDER.includes(e)))
    : [];
  const people = options?.people || [];
  const opt = (xs?: string[]) => (xs || []).map((x) => ({ id: x, name: x }));
  const set = (k: keyof Filters) => (v: string[]) => setFilters({ ...filters, [k]: v });
  const nApplied = activeCount(applied);
  const autoGrid = (min: number): CSSProperties => ({ display: 'grid', gap: 'var(--space-4)', gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}px, 100%), 1fr))` });

  const bugsData = bugs?.data;
  const bugsBlock = (body: React.ReactNode) => {
    if (!bugs) return <Skeleton variant="tile" height={150} />;
    if (bugs.error) return <ErrorNote onRetry={() => void loadBugs()}>Bug data: {bugs.error}</ErrorNote>;
    if (bugsData && !bugsData.configured) return <Empty>Jira is not configured, so bug charts are unavailable.</Empty>;
    return <>{bugsData?.jiraError && <ErrorNote onRetry={() => void loadBugs()}>Jira: {bugsData.jiraError}</ErrorNote>}{body}</>;
  };
  const insightsState = !res ? <Skeleton rows={3} /> : (res.insights.error || insights?.error) ? <ErrorNote onRetry={refresh}>Insights: {res.insights.error || insights?.error}</ErrorNote> : null;
  const daysSel = (
    <select style={ctl} value={bugDays} onChange={(e) => { setBugs(null); setBugDays(Number(e.target.value)); }} aria-label="Bug chart window">
      {[7, 14, 30, 60].map((d) => <option key={d} value={d}>{d} days</option>)}
    </select>
  );

  return (
    <div className="stack" style={{ marginTop: 0 }}>
      <style>{CSS}</style>
      <div className="page-h" style={{ marginBottom: 0 }}>
        <h1>Tickets</h1>
        <p>What was just raised, what is moving, what is stuck{stats?.projects ? ` · ${stats.projects.join(', ')}` : ''}</p>
      </div>

      <div role="toolbar" aria-label="Ticket view controls" style={{ ...row, justifyContent: 'space-between' }}>
        <div style={row}>
          <select style={ctl} value={days} onChange={(e) => { setLoading(true); setDays(Number(e.target.value)); }} aria-label="Window">
            {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>Last {d} days</option>)}
          </select>
          <select style={ctl} value={stuckDays} onChange={(e) => { setLoading(true); setStuckDays(Number(e.target.value)); }} aria-label="Stuck threshold">
            {[3, 5, 7, 14, 30].map((d) => <option key={d} value={d}>Stuck ≥ {d}d</option>)}
          </select>
          <button type="button" className="btn" style={b34} onClick={refresh} disabled={loading}>{loading ? 'Loading…' : '↺ Refresh'}</button>
        </div>
        <button type="button" className="btn" style={{ ...b34, display: 'inline-flex', alignItems: 'center', gap: 8 }} aria-expanded={filtersOpen} aria-controls="tkt-filters" onClick={() => setFiltersOpen(!filtersOpen)}>
          <span aria-hidden="true">{filtersOpen ? '▾' : '▸'}</span> Filters
          {nApplied > 0 && <span className="vchip" aria-label={`${nApplied} filter${nApplied === 1 ? '' : 's'} applied`}>{nApplied}</span>}
        </button>
      </div>

      <section aria-label="Filters" style={{ display: 'grid', gap: 8 }}>
        {filtersOpen && (
          <div id="tkt-filters" style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 'var(--pad-card)', position: 'relative', zIndex: 5, display: 'grid', gap: 8 }}>
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
              <button type="button" className="btn" aria-pressed="true" style={b34} onClick={() => apply(filters)}>Apply filters</button>
              <button type="button" className="btn" style={b34} onClick={() => apply(EMPTY)} disabled={activeCount(filters) === 0 && nApplied === 0}>Clear</button>
            </div>
          </div>
        )}
        <div style={row}>
          <span className="subtle">Quick:</span>
          <button type="button" className="btn" style={b34} onClick={() => apply({ ...EMPTY, type: ['Bug'] })}>Bugs</button>
          <button type="button" className="btn" style={b34} onClick={() => apply({ ...EMPTY, assignee: ['unassigned'] })}>Unassigned</button>
          <button type="button" className="btn" style={b34} onClick={() => apply({ ...EMPTY, from: iso(7) })}>Created last 7d</button>
          <button type="button" className="btn" style={b34} onClick={() => apply({ ...EMPTY, type: ['Bug'], from: iso(7) })}>New bugs (7d)</button>
          <button type="button" className="btn" style={b34} onClick={() => apply({ ...EMPTY, type: ['Bug'], priority: ['Highest', 'High'] })}>High-priority bugs</button>
          {nApplied > 0 && <button type="button" className="btn" style={b34} onClick={() => apply(EMPTY)}>Clear filters</button>}
          {nApplied > 0 && <span className="subtle">{nApplied} filter{nApplied === 1 ? '' : 's'} applied to the pulse, stuck, ready-to-ship and explorer (sprint panel, bug charts and tickets-by-environment are not filtered)</span>}
        </div>
      </section>

      {notConfigured && (
        <Card title="Jira is not configured">
          <p className="muted" style={{ marginTop: 0 }}>Add these Vercel environment variables (Production) and redeploy:</p>
          <pre style={{ background: 'var(--panel-2)', padding: 12, borderRadius: 'var(--r-sm)', overflowX: 'auto', fontSize: 'var(--fs-xs)', margin: 0 }}>{`JIRA_BASE_URL=https://<your-site>.atlassian.net
JIRA_EMAIL=<atlassian account email>
JIRA_API_TOKEN=<API token>
JIRA_PROJECT_KEYS=CORE,EMR   # comma separated`}</pre>
        </Card>
      )}

      {/* (2) pulse */}
      {!res && <Skeleton variant="tile" height={150} />}
      {res?.stats.error && <ErrorNote onRetry={refresh}>Metrics: {res.stats.error}</ErrorNote>}
      {stats?.configured && stats.error && <ErrorNote onRetry={refresh}>Metrics: {stats.error}</ErrorNote>}
      {stats?.totals && <Pulse stats={stats} bugs={bugsData || null} days={days} />}

      {/* (3) graph row */}
      <div className="tkt-graphs">
        <div className="card tkt-wide">
          <div className="card-h"><h2>Bugs raised vs resolved</h2>{daysSel}</div>
          <div className="subtle" style={{ marginTop: -4, marginBottom: 8 }}>Resolved = reached QA Passed or any later stage.</div>
          {bugsData?.truncated && (
            <div role="note" style={{ marginBottom: 8, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--warn-text)', color: 'var(--warn-text)', fontSize: 12 }}>
              <strong>Note:</strong> Some counts may be incomplete: this window has more tickets than the dashboard fetches. Choose a shorter window for exact numbers.
            </div>
          )}
          {bugsBlock(bugsData && <BugFlowChart series={bugsData.bugSeries} height={220} />)}
        </div>
        <div className="tkt-side">
          <Card title="Open bugs by priority (not yet QA passed)">{bugsBlock(bugsData && <PriorityBars data={bugsData.open.byPriority} />)}</Card>
          <Card title="Open bugs by age (not yet QA passed)">{bugsBlock(bugsData && <AgeBuckets data={bugsData.open.byAge} />)}</Card>
        </div>
        <div className="tkt-stage">
        <Card title="Delivery flow">
          {!res ? <Skeleton rows={4} /> : res.stats.error ? <ErrorNote onRetry={refresh}>Metrics: {res.stats.error}</ErrorNote>
            : <StageBars stages={(stats?.byStage || []).map((s) => ({ name: s.name, count: s.value }))} />}
        </Card>
        </div>
      </div>

      {/* (3b) quality: time to resolve and reopened bugs */}
      <QualityPanel />

      {/* (4) what was raised / what is moving */}
      <div className="tkt-two">
        <section className="card" aria-label="Recent bugs">
          <RecentBugs bugs={bugsData?.recent ?? null} loading={!bugs} error={bugs?.error || null} onRetry={() => void loadBugs()} days={bugDays} />
        </section>
        <section className="card" aria-label="Activity">
          <ActivityLog key={tick} days={bugDays} />
        </section>
      </div>

      {/* (5) detail disclosures */}
      <Section id="ready" title="Ready to ship" meta={insights?.readyToShip ? `${insights.readyToShip.total} in ${insights.readyToShip.statuses.join(', ') || 'QA Passed'}` : undefined}>
        {insightsState ?? (insights?.readyToShip ? (
          <>
            <div className="subtle" style={{ marginBottom: 8 }}>Oldest first (showing {insights.readyToShip.shownOldestFirst}). {insights.readyToShip.notInProd} of these have not been seen in a Production deployment. “Idle” = days since the ticket was last updated.</div>
            <AgedTable items={insights.readyToShip.items} showEnv />
          </>
        ) : <Empty>Nothing ready to ship.</Empty>)}
      </Section>

      <Section id="stuck" title="Stuck tickets" meta={insights?.stuck ? `${insights.stuck.total} idle ≥ ${insights.stuckDays} days` : undefined}>
        {insightsState ?? (insights?.stuck ? (
          <>
            <div className="subtle" style={{ marginBottom: 8 }}>In {insights.stuck.statuses.join(', ')} with no update for {insights.stuckDays}+ days (oldest first, top 40).</div>
            {insights.stuck.items.length ? <AgedTable items={insights.stuck.items} /> : <Empty>Nothing stuck.</Empty>}
          </>
        ) : <Empty>Nothing stuck.</Empty>)}
      </Section>

      <Section id="leadtime" title="Lead time">
        {insightsState ?? (insights?.leadTime ? (
          <>
            <div className="subtle" style={{ marginBottom: 8 }}>Tasks/stories/bugs done in the last {insights.leadTime.windowDays} days, {insights.leadTime.sampled} sampled; sub-tasks and epics excluded.</div>
            <div style={autoGrid(150)}>
              <LTTile label="Created → done (all)" lt={insights.leadTime.overall} />
              {Object.entries(insights.leadTime.byType).filter(([, v]) => v.count >= 3).slice(0, 4).map(([k, v]) => <LTTile key={k} label={k} lt={v} />)}
              <LTTile label="Created → first prod deploy" lt={insights.leadTime.createdToProd} />
            </div>
          </>
        ) : <Empty>No lead-time data.</Empty>)}
      </Section>

      <Section id="sprint" title="Active sprint" meta={stats?.sprints?.length ? stats.sprints.map((s) => s.name).join(', ') : undefined}>
        {!res ? <Skeleton rows={3} /> : (
          <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
            {(stats?.sprints || []).map((sp) => {
              const left = sp.endDate && now ? Math.ceil((new Date(sp.endDate).getTime() - now) / DAY) : null;
              return (
                <Card key={sp.name} title={`${sp.name} (${sp.boardName})`}>
                  <div className="subtle" style={{ marginBottom: 8 }}>
                    {sp.startDate && fmtDate(sp.startDate)} → {sp.endDate && fmtDate(sp.endDate)}
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
            {stats?.sprintError && <div className="subtle">Sprint data unavailable: {stats.sprintError}</div>}
            {!stats?.sprints?.length && !stats?.sprintError && <Empty>No active sprint.</Empty>}
            {stats && (
              <div style={autoGrid(280)}>
                <Card title="By status (all)"><Bars data={stats.byStatus || []} /></Card>
                <Card title={`Open by assignee (latest ${stats.assigneeSampled ?? 0} updated)`}><Bars data={stats.byAssignee || []} /></Card>
              </div>
            )}
            {stats && (
              <Card title="Open bugs">
                {stats.openBugs && stats.openBugs.length ? <IssueTable issues={stats.openBugs} /> : <Empty>No open bugs.</Empty>}
              </Card>
            )}
          </div>
        )}
      </Section>

      <Section id="notes" title="Release notes" defaultOpen>
        <div className="subtle" style={{ marginBottom: 8 }}>Pick a deployment that references Jira tickets; copy the markdown into release notes or chat.</div>
        {res?.notes.error && <ErrorNote onRetry={refresh}>Release notes: {res.notes.error}</ErrorNote>}
        <select style={{ ...ctl, maxWidth: '100%' }} aria-label="Deployment" value={notesId} onChange={(e) => void loadNotes(e.target.value)}>
          <option value="">Select a deployment…</option>
          {notesList.map((n) => <option key={n.id} value={n.id}>{n.environment} · {fmtDateTime(n.started_at)} · {n.keys.join(', ')}</option>)}
        </select>
        {notesErr && <div style={{ marginTop: 8 }}><ErrorNote>{notesErr}</ErrorNote></div>}
        {notesMd && (
          <div style={{ marginTop: 8 }}>
            <pre style={{ background: 'var(--panel-2)', padding: 12, borderRadius: 'var(--r-sm)', overflow: 'auto', maxHeight: 360, fontSize: 'var(--fs-xs)', margin: '0 0 8px' }}>{notesMd}</pre>
            <button type="button" className="btn" style={b34} onClick={() => void copyNotes()}>{copied ? 'Copied ✓' : 'Copy markdown'}</button>
          </div>
        )}
        {res && !res.notes.error && notesList.length === 0 && <Empty>No deployments with Jira keys yet. They appear once deploys carry <code>Jira: VID-123</code> in their notes.</Empty>}
      </Section>

      <Section id="env" title="Tickets by environment">
        {!res ? <Skeleton rows={3} /> : res.deployed.error ? <ErrorNote onRetry={refresh}>Tickets by environment: {res.deployed.error}</ErrorNote> : deployed && (
          <>
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
                            <td key={e} style={{ textAlign: 'center', color: 'var(--ok-text)', fontWeight: 700 }} title={environments[e] ? fmtDateTime(environments[e]) : ''}>
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
          </>
        )}
      </Section>

      <Section id="explorer" title="Ticket explorer" defaultOpen meta={explorer && explorer.total !== undefined ? `${explorer.total} match${explorer.total === 1 ? '' : 'es'}${explorer.shown < explorer.total ? ` (showing ${explorer.shown})` : ''}` : undefined}>
        {!res ? <Skeleton rows={5} /> : res.explorer.error ? <ErrorNote onRetry={refresh}>Tickets: {res.explorer.error}</ErrorNote> : explorer && (
          <>
            {explorer.error && <ErrorNote>{explorer.error}</ErrorNote>}
            <div style={{ ...row, marginBottom: 8 }}>
              <select style={ctl} value={sort} onChange={(e) => { setLoading(true); setSort(e.target.value); }} aria-label="Sort">
                <option value="updated">Recently updated</option><option value="created">Newest first</option><option value="oldest">Oldest first</option>
                <option value="priority">Priority</option><option value="idle">Longest idle</option>
              </select>
              <button type="button" className="btn" style={b34} onClick={() => exportCsv(explorer.issues)} disabled={!explorer.issues?.length}>Export CSV</button>
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
                        <td className="muted" style={{ whiteSpace: 'nowrap' }}>{i.created ? fmtDate(i.created) : '—'}</td>
                        <td className="muted tnum" style={{ textAlign: 'center' }}>{idleDays(i.updated, now) ?? '—'}d</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : !explorer.error && <Empty>No tickets match these filters.</Empty>}
          </>
        )}
      </Section>
    </div>
  );
}
