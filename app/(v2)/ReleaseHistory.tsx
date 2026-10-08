'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chip, ErrorNote, StatusPill, ago, fmtDateTime } from './ui';

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
type Density = 'comfortable' | 'compact';

const STATUSES = ['Success', 'In Progress', 'Failed', 'Rolled Back', 'Cancelled'];
const PAGE = 25;
const API_LIMIT = 1000;
const DAY = 86_400_000;
const DENSITY_KEY = 'tracker-density';

const isRerun = (s: string) => /^rerun\s*-/i.test(s);
const baseStatus = (s: string) => s.replace(/^rerun\s*-\s*/i, '').trim();
const isProd = (e: string) => /^production/i.test(e);
const isUrl = (s?: string | null): s is string => !!s && /^https?:\/\//i.test(s);
const abs = (iso?: string | null) => fmtDateTime(iso);

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

/** Version cell content: up to two lines of {tag, text}. */
interface VerLine { tag?: 'FE' | 'BE'; text: string }
function versionLines(r: Row): VerLine[] {
  const fe = r.frontend_branch || r.frontend_version;
  const be = r.backend_branch || r.backend_version;
  if (fe || be) {
    const out: VerLine[] = [];
    if (fe) out.push({ tag: 'FE', text: fe });
    if (be) out.push({ tag: 'BE', text: be });
    return out;
  }
  const out: VerLine[] = [{ text: r.branch || r.version || '—' }];
  if (r.branch && r.version) out.push({ text: r.version });
  return out;
}

function peopleLine(r: Row): string {
  return ([['Requested', r.requested_by], ['Approved', r.approved_by], ['Tested', r.tested_by], ['Deployed', r.deployed_by]] as const)
    .filter(([, v]) => !!v).map(([k, v]) => `${k} by ${v}`).join(' · ');
}

const RH_CSS = `
.rh-bar{position:sticky;top:var(--topbar-h,52px);z-index:3;display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:8px 0;margin-bottom:4px;background:var(--bg);border-bottom:1px solid var(--border)}
.rh-t{border-collapse:separate;border-spacing:0;width:100%}
.rh-t thead th{position:sticky;top:calc(var(--topbar-h,52px) + var(--rh-bar-h,0px));z-index:2;background:var(--bg);text-transform:uppercase;font-size:12px;letter-spacing:.04em;padding:8px 10px;text-align:left;border-bottom:1px solid var(--border-bright)}
.rh-t thead th button{text-transform:uppercase;letter-spacing:.04em}
.rh-t tbody td{padding:var(--pad-cell-y,8px) 10px;font-size:13.5px;line-height:19px;vertical-align:top;border-bottom:1px solid var(--border)}
.rh-t tbody tr{min-height:var(--row-h,56px)}
.rh-t tbody tr:hover{background:rgba(127,127,127,.09)}
.rh-t tbody tr.rh-sel,.rh-t tbody tr.rh-sel:hover{background:rgba(var(--accent-rgb),.12)}
.rh-t button:focus-visible,.rh-t a:focus-visible,.rh-bar button:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:3px}
.rh-c-det{width:100%;max-width:0}
.rh-c-sel,.rh-c-act{white-space:nowrap}
.rh-l1,.rh-l2{display:flex;align-items:center;gap:6px;min-width:0}
.rh-l2{margin-top:2px;font-size:13px;color:var(--muted)}
.rh-l1{flex-wrap:nowrap;white-space:nowrap}
.rh-trunc{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.rh-ver{max-width:240px}
.rh-tag{flex:none;font-size:10.5px;font-weight:700;letter-spacing:.04em;padding:0 5px;border-radius:4px;line-height:16px;border:1px solid var(--border-bright)}
.rh-mono{font-family:var(--font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12.5px}
.rh-more{background:none;border:0;padding:0;color:var(--accent-text);font-size:13px;cursor:pointer;flex:none}
.rh-wrap[data-density='compact'] .rh-l2,.rh-wrap[data-density='compact'] .rh-notes{display:none}
.rh-wrap[data-density='compact'] .rh-t tbody td{padding-top:var(--pad-cell-y,4px);padding-bottom:var(--pad-cell-y,4px);vertical-align:middle}
/* Wide-screen column set: extra cells always rendered, toggled by media queries. */
.rh-t .rh-wide{display:none}
.rh-people{display:block}
.rh-runs{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;min-width:0}
.rh-wn{display:flex;gap:6px;align-items:baseline;color:var(--muted);font-size:13px;line-height:18px;min-width:0}
.rh-wn>div{flex:1 1 auto;min-width:0}
.rh-clamp{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere}
.rh-wrap[data-density='compact'] .rh-clamp{-webkit-line-clamp:1}
.rh-t{--rh-pw:110px;--rh-vw:190px}
@media (min-width:1950px){
  .rh-t{table-layout:fixed}
  .rh-t th.rh-wide,.rh-t td.rh-wide{display:table-cell}
  .rh-t .rh-narrow-only{display:none}
  .rh-t thead th,.rh-t tbody td{padding-left:8px;padding-right:8px;box-sizing:border-box}
  .rh-t tbody td{overflow:hidden}
  .rh-t th.rh-h-sel{width:34px}
  .rh-t th.rh-h-env{width:130px}
  .rh-t th.rh-h-st{width:105px}
  .rh-t th.rh-h-ver{width:var(--rh-vw)}
  .rh-t th.rh-h-when{width:150px}
  .rh-t th.rh-h-pp{width:var(--rh-pw)}
  .rh-t th.rh-h-run{width:130px}
  .rh-t th.rh-h-act{width:140px}
  .rh-ver{max-width:none}
}
@media (min-width:2300px){.rh-t{--rh-pw:150px;--rh-vw:210px}.rh-t th.rh-h-run{width:170px}}
@media (min-width:3000px){.rh-t{--rh-pw:200px;--rh-vw:260px}.rh-t th.rh-h-run{width:220px}.rh-t th.rh-h-env{width:170px}}
.rh-sk{display:grid;grid-template-columns:24px 1.2fr 1fr 1.4fr 1.2fr 2fr;gap:14px;padding:12px 10px;border-bottom:1px solid var(--border)}
.rh-sk span{display:block;height:14px;border-radius:4px}
.rh-state{padding:28px 12px;text-align:center;display:flex;flex-direction:column;gap:10px;align-items:center}
@media (max-width:700px){
  .rh-bar>input[type=search]{flex-basis:100%;max-width:none!important}
  .rh-t,.rh-t tbody{display:block}
  .rh-t thead{display:flex;gap:12px;padding:6px 0;position:static}
  .rh-t thead tr{display:flex;gap:12px}
  .rh-t thead th{position:static;display:none;padding:2px 0;border:0}
  .rh-t thead th.rh-sort-m{display:block}
  .rh-t tbody tr{display:grid;grid-template-columns:auto 1fr auto;grid-template-areas:'sel env status' 'ver ver when' 'det det det' 'act act act';gap:4px 10px;padding:10px;margin-bottom:8px;border:1px solid var(--border);border-radius:var(--r-sm,6px)}
  .rh-t tbody td{display:block;padding:0;border:0;min-width:0}
  .rh-c-sel{grid-area:sel}.rh-c-env{grid-area:env}.rh-c-st{grid-area:status}.rh-c-ver{grid-area:ver}.rh-c-when{grid-area:when;text-align:right}.rh-c-det{grid-area:det;width:auto;max-width:none}.rh-c-act{grid-area:act}
  .rh-wrap[data-density='compact'] .rh-l2{display:none}
  .rh-l1{flex-wrap:wrap;white-space:normal}
  .rh-ver{max-width:none}
}
`;

function Linkified({ text }: { text: string }) {
  return <>{text.split(/(https?:\/\/[^\s<>"')]+)/g).map((p, i) =>
    i % 2 ? <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="key" style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{p}</a> : p)}</>;
}

/** One-line clamped notes with an inline more/less toggle. */
function Notes({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 80 || text.includes('\n');
  return (
    <div className="rh-notes" style={{ display: 'flex', gap: 6, alignItems: open ? 'flex-start' : 'baseline', fontSize: 13, lineHeight: '18px', color: 'var(--muted)', marginTop: 2 }}>
      <div className={open ? undefined : 'rh-trunc'} style={open ? { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', minWidth: 0 } : { flex: '0 1 auto' }}>
        {open ? <Linkified text={text} /> : text.split('\n')[0]}
      </div>
      {long && <button type="button" className="rh-more" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{open ? 'less' : 'more'}</button>}
    </div>
  );
}

function PRChips({ prs }: { prs: PR[] }) {
  return <>{prs.map((p) => (
    <a key={p.label} href={p.url} target="_blank" rel="noopener noreferrer" title={`GitHub ${p.type} pull request`} className="vchip tnum"
      style={{ color: p.type === 'BE' ? 'var(--ok-text)' : p.type === 'FE' ? 'var(--accent-text)' : undefined }}>🔀 {p.label}</a>
  ))}</>;
}

function VersionTag({ tag }: { tag: 'FE' | 'BE' }) {
  return <b className="rh-tag" style={{ color: tag === 'FE' ? 'var(--fe-text, var(--muted))' : 'var(--be-text, var(--muted))' }}>{tag}</b>;
}

function VersionCell({ r }: { r: Row }) {
  const lines = versionLines(r);
  return <>{lines.map((l, i) => (
    <div key={i} className={i === 0 ? 'rh-l1' : 'rh-l2'}>
      {l.tag && <VersionTag tag={l.tag} />}
      <span className="rh-mono rh-trunc rh-ver" title={l.text}>{l.text}</span>
    </div>
  ))}</>;
}

function RunLink({ link }: { link: string }) {
  return isUrl(link)
    ? <a href={link} target="_blank" rel="noopener noreferrer" className="key" title={link}>🔗 {ticketText(link)}</a>
    : <span className="rh-trunc" title={link}>{link}</span>;
}

function DetailsCell({ r, prs }: { r: Row; prs: PR[] }) {
  const people = peopleLine(r);
  const tip = [people, r.notes].filter(Boolean).join('\n') || undefined;
  return (
    <>
      <div className="rh-l1" title={tip}>
        {r.ticket_link && <RunLink link={r.ticket_link} />}
        <PRChips prs={prs} />
        {!r.ticket_link && prs.length === 0 && <span className="muted">—</span>}
      </div>
      {people && <div className="rh-l2" title={people}><span className="rh-trunc">{people}</span></div>}
      {r.notes && <Notes text={r.notes} />}
    </>
  );
}

function PersonCell({ v }: { v?: string | null }) {
  return (
    <td className="rh-wide rh-c-pp">
      {v ? <span className="rh-trunc rh-people" title={v}>{v}</span> : <span className="muted">—</span>}
    </td>
  );
}

function RunsCell({ r, prs }: { r: Row; prs: PR[] }) {
  return (
    <td className="rh-wide rh-c-run">
      <div className="rh-runs">
        {r.ticket_link && <RunLink link={r.ticket_link} />}
        <PRChips prs={prs} />
        {!r.ticket_link && prs.length === 0 && <span className="muted">—</span>}
      </div>
    </td>
  );
}

/** Wide-mode notes: clamped to 2 lines (1 in compact) with more/less. */
function NotesCell({ text }: { text?: string | null }) {
  const [open, setOpen] = useState(false);
  if (!text) return <td className="rh-wide rh-c-notes"><span className="muted">—</span></td>;
  const long = text.length > 110 || text.includes('\n');
  return (
    <td className="rh-wide rh-c-notes">
      <div className="rh-wn">
        <div className={open ? undefined : 'rh-clamp'} title={open ? undefined : text} style={open ? { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } : undefined}>
          {open ? <Linkified text={text} /> : text}
        </div>
        {long && <button type="button" className="rh-more" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{open ? 'less' : 'more'}</button>}
      </div>
    </td>
  );
}

function SkeletonRows({ n = 6 }: { n?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading deployments" role="status">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="rh-sk" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((c) => <span key={c} className="skeleton" style={{ width: c === 0 ? 16 : `${88 - ((i + c) % 4) * 14}%` }} />)}
        </div>
      ))}
    </div>
  );
}

function DensityToggle({ value, onChange }: { value: Density; onChange: (d: Density) => void }) {
  return (
    <div className="density-toggle" role="group" aria-label="Row density">
      {(['comfortable', 'compact'] as const).map((d) => (
        <button key={d} type="button" aria-pressed={value === d} onClick={() => onChange(d)}>{d === 'comfortable' ? 'Comfortable' : 'Compact'}</button>
      ))}
    </div>
  );
}

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
  const [density, setDensityState] = useState<Density>('comfortable');
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const prevIds = useRef<Set<string> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    try {
      const v = localStorage.getItem(DENSITY_KEY);
      if (v === 'compact' || v === 'comfortable') setDensityState(v);
    } catch { /* storage unavailable */ }
  }, []);
  const setDensity = (d: Density) => {
    setDensityState(d);
    try { localStorage.setItem(DENSITY_KEY, d); } catch { /* ignore */ }
  };

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/deployments?limit=${API_LIMIT}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as Row[];
      const list = Array.isArray(j) ? j : [];
      const prev = prevIds.current;
      if (prev) {
        const fresh = list.filter((x) => !prev.has(x.id)).map((x) => x.id);
        if (fresh.length) {
          setFlash(new Set(fresh));
          clearTimeout(flashTimer.current);
          flashTimer.current = setTimeout(() => setFlash(new Set()), 2000);
        }
      }
      prevIds.current = new Set(list.map((x) => x.id));
      setRows(list);
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
      clearTimeout(flashTimer.current);
      window.removeEventListener('tracker:data-changed', onData);
      window.removeEventListener('tracker:refresh', onData);
      window.removeEventListener('tracker:auth-changed', onAuth);
    };
  }, [load, loadAuth]);

  // Keep the sticky table header just below the (variable-height) sticky toolbar.
  useEffect(() => {
    const bar = barRef.current, sec = sectionRef.current;
    if (!bar || !sec || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => sec.style.setProperty('--rh-bar-h', `${bar.offsetHeight}px`));
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);

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
      return [r.branch, r.version, r.ticket_link, r.requested_by, r.approved_by, r.tested_by, r.deployed_by, r.notes, r.frontend_branch, r.backend_branch, r.frontend_version, r.backend_version]
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

  const selectStyle = { fontSize: 'var(--fs-sm)', minHeight: 34, border: '1px solid var(--border-bright)', background: 'var(--panel)', color: 'var(--text)', borderRadius: 'var(--r-sm)', padding: '4px 8px' } as const;
  const th = (label: string, key: SortKey, cls: string) => (
    <th scope="col" className={`rh-sort-m ${cls}`} aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => toggleSort(key)} style={{ ...plain, fontWeight: 600, color: 'var(--muted)', fontSize: 12 }}>
        {label}<span aria-hidden="true"> {sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );
  const field = (label: string, v: React.ReactNode) => (
    <tr><td className="muted">{label}</td><td style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{v || '—'}</td></tr>
  );
  const selPrs = sel ? extractPRs(sel.notes, sel.ticket_link) : [];
  const capped = !!rows && rows.length >= API_LIMIT;
  const meta = rows ? `Showing ${filtered.length} of ${rows.length}${capped ? ` (latest ${API_LIMIT} loaded)` : ''}` : '';

  return (
    <section ref={sectionRef} className="panel-quiet fade-in" aria-label="Deployment history">
      <style>{RH_CSS}</style>
      <div className="section-h" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--fs-md)' }}>Deployment history</h2>
        {meta && <span className="muted" style={{ fontSize: 13 }}>{meta}</span>}
      </div>

      <div ref={barRef} className="rh-bar">
        <input type="search" aria-label="Search deployments" placeholder="Search branch, version, ticket, person, notes" value={q} style={{ height: 34, flex: '1 1 240px', maxWidth: 340, minWidth: 0 }}
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
        {rows && <span className="muted tnum" role="status" style={{ fontSize: 13, marginLeft: 'auto', whiteSpace: 'nowrap' }}>{filtered.length} of {rows.length}</span>}
        <DensityToggle value={density} onChange={setDensity} />
      </div>

      {picked.length > 0 && (
        <div role="region" aria-label="Compare deployments" style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', margin: 'var(--space-2) 0', padding: '3px 10px', background: 'rgba(var(--accent-rgb), .10)', border: '1px solid var(--accent)', borderRadius: 'var(--r-sm)' }}>
          <strong className="tnum" style={{ fontSize: 'var(--fs-sm)' }}>{picked.length}/2 selected</strong>
          <button type="button" className="btn" disabled={picked.length !== 2} onClick={compare}>Compare</button>
          <button type="button" className="btn" onClick={() => setPicked([])}>Clear</button>
        </div>
      )}

      {error && (
        <ErrorNote>
          <span>Could not load deployment history ({error}).{rows ? ' Showing last loaded data.' : ''}</span>{' '}
          <button type="button" className="btn" onClick={() => { load(); }}>Retry</button>
        </ErrorNote>
      )}
      {!rows && !error && <SkeletonRows />}
      {rows && filtered.length === 0 && (
        <div className="rh-state empty">
          <p style={{ margin: 0 }}>{filtersActive ? 'No deployments match these filters' : 'No deployments recorded yet'}</p>
          {filtersActive && <button type="button" className="btn" onClick={clearAll}>Clear filters</button>}
        </div>
      )}
      {shown.length > 0 && (
        <div className="rh-wrap" data-density={density}>
          <table className="rh-t">
            <thead><tr>
              <th scope="col" className="rh-h-sel"><span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Select</span></th>
              <th scope="col" aria-sort={sort.key === 'env' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className="rh-sort-m rh-h-env">
                <button type="button" onClick={() => toggleSort('env')} style={{ ...plain, fontWeight: 600, color: 'var(--muted)', fontSize: 12 }}>
                  Environment<span aria-hidden="true"> {sort.key === 'env' ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
                </button>
              </th>
              {th('Status', 'status', 'rh-h-st')}
              <th scope="col" className="rh-h-ver">Version</th>
              {th('When', 'when', 'rh-h-when')}
              <th scope="col" className="rh-narrow-only">Details</th>
              <th scope="col" className="rh-wide rh-h-pp">Requested By</th>
              <th scope="col" className="rh-wide rh-h-pp">Approved By</th>
              <th scope="col" className="rh-wide rh-h-pp">Tested By</th>
              <th scope="col" className="rh-wide rh-h-pp">Deployed By</th>
              <th scope="col" className="rh-wide rh-h-run">Run / PRs</th>
              <th scope="col" className="rh-wide rh-h-notes">Notes</th>
              {admin && <th scope="col" className="rh-h-act">Actions</th>}
            </tr></thead>
            <tbody>
              {shown.map((r) => {
                const prs = extractPRs(r.notes, r.ticket_link);
                const checked = picked.includes(r.id);
                const type = r.deployment_type && !/^standard$/i.test(r.deployment_type) ? r.deployment_type : '';
                const rerun = isRerun(r.status);
                const cls = [checked ? 'rh-sel' : '', flash.has(r.id) ? 'flash-new' : ''].filter(Boolean).join(' ') || undefined;
                const tip = [type, rerun ? 'rerun' : '', dur(r.duration_seconds)].filter(Boolean).join(' · ') || undefined;
                return (
                  <tr key={r.id} className={cls}>
                    <td className="rh-c-sel"><input type="checkbox" checked={checked} onChange={() => togglePick(r.id)} aria-label={`Select ${r.environment} deployment, ${abs(r.started_at)}, for comparison`} /></td>
                    <td className="rh-c-env" title={tip}>
                      <div className="rh-l1" style={{ fontWeight: 500 }}>{r.environment} {isProd(r.environment) && <Chip>PROD</Chip>}</div>
                      {(type || rerun) && <div className="rh-l2">{type && <span className="rh-trunc">{type}</span>}{rerun && <Chip>rerun</Chip>}</div>}
                    </td>
                    <td className="rh-c-st" title={tip}>
                      <div className="rh-l1"><StatusPill status={baseStatus(r.status)} /></div>
                      {r.duration_seconds != null && <div className="rh-l2 rh-mono">{dur(r.duration_seconds)}</div>}
                    </td>
                    <td className="rh-c-ver"><VersionCell r={r} /></td>
                    <td className="rh-c-when">
                      <div className="rh-l1">
                        <button type="button" className="rh-mono" aria-label={`Open details for ${r.environment} deployment, ${abs(r.started_at)}`} style={{ ...plain, fontFamily: 'inherit', fontSize: 12.5 }}
                          onClick={(e) => open(r, e.currentTarget)}>{abs(r.started_at)}</button>
                      </div>
                      <div className="rh-l2">{ago(r.started_at)}</div>
                    </td>
                    <td className="rh-c-det rh-narrow-only"><DetailsCell r={r} prs={prs} /></td>
                    <PersonCell v={r.requested_by} />
                    <PersonCell v={r.approved_by} />
                    <PersonCell v={r.tested_by} />
                    <PersonCell v={r.deployed_by} />
                    <RunsCell r={r} prs={prs} />
                    <NotesCell text={r.notes} />
                    {admin && (
                      <td className="rh-c-act">
                        <button type="button" className="btn" onClick={() => emit('tracker:edit-deployment', r)} aria-label={`Edit ${r.environment} deployment, ${abs(r.started_at)}`}>Edit</button>{' '}
                        <button type="button" className="btn" style={{ color: 'var(--bad-text)' }} onClick={() => emit('tracker:delete-deployment', r)} aria-label={`Delete ${r.environment} deployment, ${abs(r.started_at)}`}>Delete</button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
    </section>
  );
}
