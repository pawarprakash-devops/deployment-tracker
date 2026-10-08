'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { ActivityEvent, ActivityKind, ActivityResponse } from '@/lib/tickets-types';
import { Chip, Empty, ErrorNote, LiveDot, Pill, Skeleton, fmtDate, fmtDateTime, useNow } from '../ui';
import type { Tone } from '../ui';

const PAGE = 40;
const WINDOWS: { days: number; label: string }[] = [
  { days: 1, label: '24 h' }, { days: 3, label: '3 days' }, { days: 7, label: '7 days' }, { days: 14, label: '14 days' }, { days: 30, label: '30 days' },
];
const KINDS: { kind: ActivityKind; label: string }[] = [
  { kind: 'created', label: 'Created' }, { kind: 'status', label: 'Status' }, { kind: 'assignee', label: 'Assignee' }, { kind: 'priority', label: 'Priority' },
  { kind: 'comment', label: 'Comment' }, { kind: 'resolved', label: 'Resolved' }, { kind: 'deploy', label: 'Deployed' }, { kind: 'other', label: 'Other' },
];
const GLYPH: Record<ActivityKind, { g: string; tone: Tone; label: string }> = {
  created: { g: '+', tone: 'info', label: 'Created' },
  status: { g: '→', tone: 'neutral', label: 'Status change' },
  assignee: { g: '@', tone: 'neutral', label: 'Assignee change' },
  priority: { g: '!', tone: 'warn', label: 'Priority change' },
  comment: { g: '“', tone: 'neutral', label: 'Comment' },
  resolved: { g: '✓', tone: 'ok', label: 'Resolved' },
  deploy: { g: '↑', tone: 'ok', label: 'Deployment' },
  other: { g: '·', tone: 'neutral', label: 'Other' },
};
const PRIORITY_RANK = ['lowest', 'low', 'medium', 'high', 'highest'];
const ctl: CSSProperties = { height: 34, minHeight: 34, border: '1px solid var(--border-bright)', background: 'var(--panel)', color: 'var(--text)', borderRadius: 'var(--r-sm)', padding: '0 10px', fontSize: 'var(--fs-sm)', fontFamily: 'inherit' };

function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function relTime(atMs: number, now: number | null): string {
  if (now == null) return fmtDate(atMs);
  const s = Math.max(0, (now - atMs) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function dayHeading(atMs: number, now: number | null): string {
  if (now != null) {
    if (dayKey(atMs) === dayKey(now)) return 'Today';
    if (dayKey(atMs) === dayKey(now - 86_400_000)) return 'Yesterday';
  }
  const wd = new Date(atMs).toLocaleDateString('en-GB', { weekday: 'long' });
  return `${fmtDate(atMs)} ${wd}`;
}

function isHttp(u: string | null): u is string {
  return !!u && /^https?:\/\//i.test(u);
}

function IssueKey({ ev }: { ev: ActivityEvent }) {
  if (isHttp(ev.url) && ev.kind !== 'deploy') {
    return <a className="key mono" href={ev.url} target="_blank" rel="noopener noreferrer">{ev.key}</a>;
  }
  return <span className="key mono">{ev.key}</span>;
}

function Quote({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 140 || text.includes('\n');
  return (
    <blockquote style={{ margin: '6px 0 0', padding: '4px 10px', borderLeft: '2px solid var(--border-bright)', color: 'var(--muted)', fontSize: 'var(--fs-sm)' }}>
      <span style={open ? { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } : { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}>{text}</span>
      {long && (
        <button type="button" className="muted" aria-expanded={open} onClick={() => setOpen((o) => !o)} style={{ border: 0, background: 'none', padding: 0, marginTop: 2, cursor: 'pointer', textDecoration: 'underline', font: 'inherit', fontSize: 'var(--fs-xs)' }}>
          {open ? 'less' : 'more'}
        </button>
      )}
    </blockquote>
  );
}

function Sentence({ ev }: { ev: ActivityEvent }) {
  const actor = ev.actor || 'Someone';
  const key = <IssueKey ev={ev} />;
  const title = ev.title ? <span className="muted"> — {ev.title}</span> : null;
  switch (ev.kind) {
    case 'created':
      return <div>{key} raised by {ev.actor || 'unknown'}: {ev.title || <span className="muted">(no title)</span>} {ev.priority && <Chip title="Priority">{ev.priority}</Chip>}</div>;
    case 'status':
      return <div>{actor} moved {key}{ev.from ? <> from <Pill>{ev.from}</Pill></> : null} → <Pill tone="info">{ev.to || 'unknown'}</Pill>{title}</div>;
    case 'assignee':
      return <div>{actor} assigned {key} to <strong>{ev.to || 'Unassigned'}</strong>{ev.from ? <span className="muted"> (was {ev.from})</span> : <span className="muted"> (was Unassigned)</span>}{title}</div>;
    case 'priority': {
      const a = PRIORITY_RANK.indexOf((ev.from || '').toLowerCase());
      const b = PRIORITY_RANK.indexOf((ev.to || '').toLowerCase());
      const verb = a < 0 || b < 0 || a === b ? 'changed' : b > a ? 'raised' : 'lowered';
      return <div>{actor} {verb} priority on {key} <Chip>{ev.from || 'None'}</Chip> → <Chip>{ev.to || 'None'}</Chip>{title}</div>;
    }
    case 'comment':
      return <div>{actor} commented on {key}{title}{ev.text && <Quote text={ev.text} />}</div>;
    case 'resolved':
      return <div>{key} resolved{ev.actor ? <> by {ev.actor}</> : null}{title}</div>;
    case 'deploy':
      return (
        <div>
          {key} deployed{ev.env ? <> to <Chip title="Environment">{ev.env}</Chip></> : null}{ev.actor ? <> by {ev.actor}</> : null}{title}
          {isHttp(ev.url) && <> <a href={ev.url} target="_blank" rel="noopener noreferrer" className="mono" style={{ fontSize: 'var(--fs-xs)' }}>run ↗</a></>}
        </div>
      );
    default:
      return <div>{actor} updated {key}{title}{ev.text && <Quote text={ev.text} />}</div>;
  }
}

function Row({ ev, now, flash, last }: { ev: ActivityEvent; now: number | null; flash: boolean; last: boolean }) {
  const g = GLYPH[ev.kind];
  const atMs = new Date(ev.at).getTime();
  return (
    <li className={flash ? 'flash-new' : undefined} style={{ display: 'flex', gap: 12, padding: '0 4px' }}>
      <div aria-hidden="true" style={{ width: 28, flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 8 }}>
        <span style={{ width: 28, height: 28, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, color: `var(--${g.tone}-text)`, background: `var(--${g.tone}-bg)`, border: `1px solid var(--${g.tone}-border)` }}>{g.g}</span>
        {!last && <span style={{ flex: 1, width: 1, background: 'var(--border)', marginTop: 4 }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0, padding: '10px 0', display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0, overflowWrap: 'anywhere', fontSize: 'var(--fs-base)' }}>
          <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap' }}>{g.label}: </span>
          <Sentence ev={ev} />
        </div>
        <time className="mono muted" dateTime={ev.at} title={fmtDateTime(ev.at)} style={{ fontSize: 12.5, flex: 'none', whiteSpace: 'nowrap', paddingTop: 2 }}>{relTime(atMs, now)}</time>
      </div>
    </li>
  );
}

export default function ActivityLog({ days = 7 }: { days?: number }) {
  const [win, setWin] = useState(days);
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [kinds, setKinds] = useState<Set<ActivityKind>>(new Set());
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  const seen = useRef<Set<string> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqSeq = useRef(0);
  const now = useNow(30000);

  const load = useCallback(async () => {
    const seq = ++reqSeq.current;
    try {
      const res = await fetch(`/api/jira/activity?days=${win}&limit=300`, { cache: 'no-store' });
      let body: (Partial<ActivityResponse> & { error?: string }) | null = null;
      try { body = (await res.json()) as Partial<ActivityResponse> & { error?: string }; } catch { body = null; }
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      if (seq !== reqSeq.current) return;
      const j = body as ActivityResponse;
      if (seen.current) {
        const fresh = j.events.filter((e) => !seen.current!.has(e.id)).map((e) => e.id);
        if (fresh.length) {
          setFlashIds(new Set(fresh));
          if (flashTimer.current) clearTimeout(flashTimer.current);
          flashTimer.current = setTimeout(() => setFlashIds(new Set()), 2000);
        }
      }
      seen.current = new Set(j.events.map((e) => e.id));
      setData(j); setError(null); setLoading(false); setUpdatedAt(Date.now());
    } catch (e) {
      if (seq !== reqSeq.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load activity');
      setLoading(false);
    }
  }, [win]);

  useEffect(() => {
    const first = setTimeout(() => { void load(); }, 0);
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 90_000);
    const onRefresh = () => { void load(); };
    window.addEventListener('tracker:refresh', onRefresh);
    window.addEventListener('tracker:data-changed', onRefresh);
    return () => {
      clearTimeout(first); clearInterval(t);
      window.removeEventListener('tracker:refresh', onRefresh);
      window.removeEventListener('tracker:data-changed', onRefresh);
    };
  }, [load]);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  const changeWindow = (d: number) => {
    seen.current = null; setData(null); setError(null); setLoading(true); setLimit(PAGE); setWin(d);
  };
  const toggleKind = (k: ActivityKind) => {
    setLimit(PAGE);
    setKinds((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  };
  const clearFilters = () => { setKinds(new Set()); setQ(''); setLimit(PAGE); };

  const filtered = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.events.filter((e) => {
      if (kinds.size && !kinds.has(e.kind)) return false;
      if (!needle) return true;
      return [e.key, e.title, e.actor, e.text, e.from, e.to, e.env].some((v) => v && v.toLowerCase().includes(needle));
    });
  }, [data, kinds, q]);

  const shown = filtered.slice(0, limit);
  const groups = useMemo(() => {
    const out: { key: string; at: number; items: ActivityEvent[] }[] = [];
    for (const e of shown) {
      const at = new Date(e.at).getTime();
      const k = dayKey(at);
      const g = out[out.length - 1];
      if (g && g.key === k) g.items.push(e); else out.push({ key: k, at, items: [e] });
    }
    return out;
  }, [shown]);

  const total = data?.events.length ?? 0;
  const windowOptions = WINDOWS.some((w) => w.days === days) ? WINDOWS : [...WINDOWS, { days, label: `${days} days` }].sort((a, b) => a.days - b.days);
  const filtersOn = kinds.size > 0 || q.trim() !== '';
  const winLabel = windowOptions.find((w) => w.days === win)?.label ?? `${win} days`;
  const upd = updatedAt != null ? new Date(updatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : null;

  let body: ReactNode;
  if (loading && !data) body = <Skeleton variant="rows" rows={6} height={44} />;
  else if (error && !data) body = <ErrorNote onRetry={() => { setLoading(true); void load(); }} detail={error}>Could not load the activity log.</ErrorNote>;
  else if (data && total === 0) {
    body = (
      <Empty icon="✓" title={`No activity in the last ${win} days`} action={win < 30 ? { label: 'Widen the window', onClick: () => changeWindow(30) } : undefined}>
        Nothing was created, changed, commented on or deployed in this window.
      </Empty>
    );
  } else if (data && filtered.length === 0) {
    body = (
      <Empty icon="∅" title="No events match these filters" action={{ label: 'Clear filters', onClick: clearFilters }}>
        Try a different kind or search term.
      </Empty>
    );
  } else {
    body = (
      <>
        {groups.map((g, gi) => (
          <section key={g.key} aria-label={dayHeading(g.at, now)}>
            <h3 style={{ position: 'sticky', top: 0, zIndex: 1, margin: 0, padding: '8px 4px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 600, color: 'var(--muted)' }}>
              {dayHeading(g.at, now)} <span className="mono" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· {g.items.length}</span>
            </h3>
            <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {g.items.map((ev, i) => (
                <Row key={ev.id} ev={ev} now={now} flash={flashIds.has(ev.id)} last={i === g.items.length - 1 && gi === groups.length - 1} />
              ))}
            </ol>
          </section>
        ))}
        {filtered.length > shown.length && (
          <div style={{ padding: '12px 0', textAlign: 'center' }}>
            <button type="button" className="btn" onClick={() => setLimit((l) => l + PAGE)}>Show {Math.min(PAGE, filtered.length - shown.length)} more</button>
          </div>
        )}
        {data?.truncated && filtered.length === shown.length && <p className="muted" style={{ fontSize: 'var(--fs-xs)', textAlign: 'center' }}>Older events in this window are not shown (limit reached).</p>}
      </>
    );
  }

  return (
    <div className="fade-in">
      <div className="section-h">
        <h2 style={{ display: 'inline-flex', alignItems: 'center', gap: 8, margin: 0 }}><LiveDot tone="info" label="Live" /> Activity log</h2>
        <span className="meta" role="status" aria-live="polite">
          {data ? `${total} event${total === 1 ? '' : 's'} in the last ${winLabel}${filtersOn ? ` · ${filtered.length} shown` : ''}${upd ? ` · updated ${upd}` : ''}` : loading ? 'Loading…' : ''}
        </span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <div role="group" aria-label="Filter by event kind" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, flex: '1 1 360px' }}>
          <button type="button" className="btn" aria-pressed={kinds.size === 0} onClick={() => { setKinds(new Set()); setLimit(PAGE); }}>All{data ? ` ${total}` : ''}</button>
          {KINDS.map(({ kind, label }) => (
            <button key={kind} type="button" className="btn" aria-pressed={kinds.has(kind)} onClick={() => toggleKind(kind)}>
              {label}{data ? ` ${data.counts?.[kind] ?? 0}` : ''}
            </button>
          ))}
        </div>
        <input type="search" aria-label="Search activity" placeholder="Search key, title, person, text…" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} style={{ ...ctl, minWidth: 0, flex: '1 1 200px' }} />
        <select aria-label="Time window" style={ctl} value={win} onChange={(e) => changeWindow(Number(e.target.value))}>
          {windowOptions.map((w) => <option key={w.days} value={w.days}>{w.label}</option>)}
        </select>
      </div>

      {data?.jiraError && total > 0 && (
        <div className="banner" role="note" style={{ padding: '5px 12px', marginBottom: 10, fontSize: 'var(--fs-xs)' }}>Jira data unavailable: {data.jiraError}; showing deployments only</div>
      )}
      {error && data && <ErrorNote onRetry={() => { void load(); }} detail={error}>Could not refresh; showing the last loaded data.</ErrorNote>}
      {body}
    </div>
  );
}
