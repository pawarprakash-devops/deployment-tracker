'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Card, Chip, Skeleton, ago } from './ui';

type Which = 'backend' | 'frontend';
interface Commit { sha: string; message: string; author?: string; url: string }
interface Promotion { number: number; url: string; mergedAt: string }
interface Pair { baseRef?: string; from: string; to: string; fromEnv: string; toEnv: string; basis?: 'promotion-pr' | 'branch-compare'; promotion?: Promotion; pending?: number; error?: string }
interface Detail { loading: boolean; error?: string; commits: Commit[]; total: number; truncated: boolean; compareUrl?: string }
interface Want { from: string; to: string }

const SHOWN = 30;
const WINDOWS = [{ label: '1:30 PM', start: 13.5 * 3600 }, { label: '4:00 PM', start: 16 * 3600 }];
const OPEN_SECS = 15 * 60; // a window stays open for 15 minutes (matches the legacy countdown)
const CSS = '.rr-row:hover{background:rgba(127,127,127,.09)}.rr-btn:focus-visible,.rr-h:focus-visible{outline:2px solid var(--focus-ring,currentColor);outline-offset:2px;border-radius:4px}';
const key = (p: { from: string; to: string }) => `${p.from}>${p.to}`;

// Seconds since midnight in IST (fixed UTC+5:30, no DST).
const istSecs = (ms: number) => Math.floor((ms + 5.5 * 3600_000) / 1000) % 86400;
const fmt = (s: number) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h > 0 ? `${h}h ${m}m` : `${m}m`; };
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const mono = { fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)' } as const;
const mutedText = { color: 'var(--muted, #8a8f98)' } as const;
const sectionH = { margin: 0, fontSize: 'var(--fs-sm, 13px)', fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase' as const, ...mutedText };

function CheckIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none', color: 'var(--ok, #2da44e)' }}><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.8 2.8L16 9.5" /></svg>
  );
}

function WaitingToShip() {
  const uid = useId();
  const [which, setWhich] = useState<Which>('backend');
  const [pairs, setPairs] = useState<Pair[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [filter, setFilter] = useState('');
  const sectionRef = useRef<HTMLElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const whichRef = useRef<Which>('backend');
  const pairsRef = useRef<Pair[] | null>(null);
  const wantRef = useRef<Want | null>(null);
  const focusRef = useRef(false);
  const reqRef = useRef(0);

  // Open a pair's commit list (always opens, never closes).
  const show = useCallback((p: Pair) => {
    const req = ++reqRef.current;
    setFilter('');
    setOpen(key(p));
    setDetail({ loading: true, commits: [], total: p.pending ?? 0, truncated: false });
    const fail = (error: string) => { if (req === reqRef.current) setDetail({ loading: false, error, commits: [], total: p.pending ?? 0, truncated: false }); };
    fetch(`/api/drift/commits?repo=${whichRef.current}&base=${encodeURIComponent(p.baseRef || p.to)}&head=${encodeURIComponent(p.from)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) return fail(String(d.error));
        if (req === reqRef.current) setDetail({ loading: false, commits: d.commits ?? [], total: d.total ?? 0, truncated: !!d.truncated, compareUrl: d.compareUrl });
      })
      .catch((e) => fail(e instanceof Error ? e.message : 'Failed to load'));
  }, []);

  // Fulfil a pending tracker:open-drift request once the right repo's pairs are present.
  const applyWant = useCallback(() => {
    const w = wantRef.current, list = pairsRef.current;
    if (!w || !list) return;
    wantRef.current = null;
    sectionRef.current?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    const p = list.find((x) => x.from === w.from && x.to === w.to);
    if (p && !p.error && (p.pending ?? 0) > 0) { focusRef.current = true; show(p); }
  }, [show]);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch(`/api/drift?repo=${which}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((d) => {
          if (!alive) return;
          if (d.error || !Array.isArray(d.pairs)) { setFailed(true); return; }
          pairsRef.current = d.pairs; setFailed(false); setPairs(d.pairs); applyWant();
        })
        .catch(() => { if (alive) setFailed(true); });
    };
    load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 300_000);
    return () => { alive = false; clearInterval(t); };
  }, [which, applyWant]);

  const choose = useCallback((w: Which) => {
    whichRef.current = w; pairsRef.current = null; reqRef.current++;
    setWhich(w); setPairs(null); setFailed(false); setOpen(null); setDetail(null); setFilter('');
  }, []);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<{ from?: string; to?: string; repo?: string }>).detail;
      if (!d || !d.from || !d.to) return;
      wantRef.current = { from: d.from, to: d.to };
      if ((d.repo === 'backend' || d.repo === 'frontend') && d.repo !== whichRef.current) choose(d.repo);
      else applyWant();
    };
    window.addEventListener('tracker:open-drift', onOpen);
    return () => window.removeEventListener('tracker:open-drift', onOpen);
  }, [choose, applyWant]);

  // Move focus to the expanded region heading when opened via the rail.
  useEffect(() => {
    if (open && focusRef.current) { focusRef.current = false; headRef.current?.focus({ preventScroll: true }); }
  }, [open]);

  const collapse = () => { reqRef.current++; setOpen(null); setDetail(null); setFilter(''); };
  const toggle = (p: Pair) => (open === key(p) ? collapse() : show(p));

  const waiting = (pairs ?? []).filter((p) => !p.error && (p.pending ?? 0) > 0).sort((a, b) => (b.pending ?? 0) - (a.pending ?? 0));
  const errored = (pairs ?? []).filter((p) => p.error);
  const synced = (pairs ?? []).filter((p) => !p.error && (p.pending ?? 0) === 0);
  const inSync = synced.length;
  const total = waiting.reduce((n, p) => n + (p.pending ?? 0), 0);

  const toggles = (
    <div role="group" aria-label="Repository" style={{ display: 'flex', gap: 6 }}>
      {(['backend', 'frontend'] as const).map((w) => (
        <button key={w} type="button" className="btn" aria-pressed={which === w} onClick={() => choose(w)}>{w === 'backend' ? 'Backend' : 'Frontend'}</button>
      ))}
    </div>
  );

  const panel = (p: Pair, id: string) => {
    const shown = detail?.commits.filter((c) => !filter || `${c.message} ${c.author ?? ''}`.toLowerCase().includes(filter.toLowerCase())).slice(0, SHOWN) ?? [];
    return (
      <div id={id} role="region" aria-labelledby={`${id}-h`} style={{ padding: '4px 8px 14px' }}>
        <h3 id={`${id}-h`} ref={headRef} tabIndex={-1} className="rr-h" style={{ margin: '0 0 6px', fontSize: 'var(--fs-sm, 13px)', fontWeight: 600 }}>Commits waiting: {p.fromEnv} → {p.toEnv}</h3>
        {detail?.loading && <Skeleton rows={3} />}
        {detail?.error && <p className="muted" style={{ margin: 0 }}>Could not load commits ({detail.error}).</p>}
        {detail && !detail.loading && !detail.error && detail.commits.length === 0 && <p className="muted" style={{ margin: 0 }}>No pending commits.</p>}
        {detail && !detail.loading && detail.commits.length > 0 && (
          <>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '4px 0 8px' }}>
              <input type="search" className="search" aria-label="Filter commits" placeholder="Filter by message or author" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
              {detail.compareUrl && <a href={detail.compareUrl} target="_blank" rel="noopener noreferrer">Open compare ↗</a>}
            </div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4, fontSize: 'var(--fs-sm, 13px)', maxHeight: 360, overflowY: 'auto' }}>
              {shown.map((c) => (
                <li key={c.sha}><a href={c.url} target="_blank" rel="noopener noreferrer"><Chip>{c.sha}</Chip></a> {c.message} {c.author && <span className="muted">· {c.author}</span>}</li>
              ))}
              {shown.length === 0 && <li className="muted">No commits match the filter.</li>}
            </ul>
            {(detail.truncated || detail.total > SHOWN) && (
              <p className="muted" style={{ margin: '8px 0 0', fontSize: 'var(--fs-sm, 13px)' }}>Showing the newest {Math.min(SHOWN, detail.commits.length)} of {detail.total}{detail.truncated ? ' (list truncated by GitHub)' : ''}.</p>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <section ref={sectionRef} className="panel-quiet fade-in" aria-labelledby={`${uid}-title`} style={{ scrollMarginTop: 16 }}>
      <style>{CSS}</style>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 'var(--space-2, 8px)' }}>
        <h2 id={`${uid}-title`} className="section-h" style={sectionH}>Waiting to ship</h2>
        {toggles}
      </div>
      <p className="muted" style={{ margin: '0 0 var(--space-3, 12px)', fontSize: 13 }}>Commits merged upstream since the last promotion PR. A leading ~ means no promotion PR was found, so the count can over-state.</p>
      <div aria-live="polite">
        {failed && <p className="muted" style={{ margin: 0 }}>Promotion drift is unavailable (needs GH_TOKEN)</p>}
        {!failed && !pairs && <Skeleton rows={3} />}
        {!failed && pairs && pairs.length === 0 && <p className="muted" style={{ margin: 0 }}>No promotion pairs configured.</p>}
        {!failed && pairs && pairs.length > 0 && waiting.length === 0 && errored.length === 0 && (
          <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}><CheckIcon />Nothing is waiting to ship</p>
        )}
      </div>
      {!failed && pairs && (waiting.length > 0 || errored.length > 0 || synced.length > 0) && (
        <>
          {waiting.length > 0 && <p className="tnum" style={{ margin: '0 0 6px', fontSize: 13, ...mutedText }}>{total} commits waiting across {waiting.length} {waiting.length === 1 ? 'pair' : 'pairs'} · {inSync} in sync</p>}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, borderTop: '1px solid var(--border, rgba(127,127,127,.25))' }}>
            {waiting.map((p, i) => {
              const k = key(p), isOpen = open === k, id = `${uid}-p${i}`;
              const n = p.pending ?? 0;
              return (
                <li key={k} style={{ borderBottom: '1px solid var(--border, rgba(127,127,127,.25))' }}>
                  <div className="rr-row" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 10, minHeight: 40, padding: '0 8px' }}>
                    <button type="button" className="rr-btn" aria-expanded={isOpen} aria-controls={isOpen ? id : undefined} onClick={() => toggle(p)} style={{ all: 'unset', boxSizing: 'border-box', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, minHeight: 40, fontSize: 14 }}>
                      <span aria-hidden="true" style={{ fontSize: 12, width: 12 }}>{isOpen ? '▾' : '▸'}</span>
                      <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{p.fromEnv} → {p.toEnv}</span>
                      <span className="mono tnum" style={mono}>· {p.basis === 'branch-compare' ? '~' : ''}{n} {n === 1 ? 'commit' : 'commits'}</span>
                    </button>
                    <span style={{ fontSize: 13, ...mutedText }}>
                      {p.promotion ? (
                        <>· last promotion <a href={p.promotion.url} target="_blank" rel="noopener noreferrer">PR #{p.promotion.number} ↗</a> · {ago(p.promotion.mergedAt)}</>
                      ) : '· no promotion PR found'}
                    </span>
                  </div>
                  {isOpen && panel(p, id)}
                </li>
              );
            })}
            {synced.map((p) => (
              <li key={key(p)} style={{ borderBottom: '1px solid var(--border, rgba(127,127,127,.25))', display: 'flex', flexWrap: 'wrap', gap: '0 10px', alignItems: 'center', minHeight: 40, padding: '0 8px', fontSize: 14 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><CheckIcon /><span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{p.fromEnv} → {p.toEnv}</span></span>
                <span className="mono tnum" style={mono}>· in sync</span>
                <span style={{ fontSize: 13, ...mutedText }}>
                  {p.promotion ? (
                    <>· last promotion <a href={p.promotion.url} target="_blank" rel="noopener noreferrer">PR #{p.promotion.number} ↗</a> · {ago(p.promotion.mergedAt)}</>
                  ) : '· no promotion PR found'}
                </span>
              </li>
            ))}
            {errored.map((p) => (
              <li key={key(p)} style={{ borderBottom: '1px solid var(--border, rgba(127,127,127,.25))', display: 'flex', gap: 8, alignItems: 'center', minHeight: 40, padding: '0 8px', fontSize: 13, ...mutedText }} title={p.error}>
                <span style={{ fontWeight: 600 }}>{p.fromEnv} → {p.toEnv}</span><span>· unavailable</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function QaWindows() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 30_000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, []);

  const secs = now === null ? null : istSecs(now);
  const state = (w: (typeof WINDOWS)[number]) => (secs === null ? 'pending' : secs >= w.start + OPEN_SECS ? 'done' : secs >= w.start ? 'open' : 'pending');
  const open = WINDOWS.find((w) => state(w) === 'open');
  const next = WINDOWS.find((w) => state(w) === 'pending');
  let headline: string | null = null;
  if (secs !== null) {
    if (open) headline = `Open now: ${open.label} IST · ${fmt(open.start + OPEN_SECS - secs)} left`;
    else if (next) headline = `Next: ${next.label} IST · in ${fmt(next.start - secs)}`;
    else headline = `Next: tomorrow ${WINDOWS[0].label} IST · in ${fmt(86400 + WINDOWS[0].start - secs)}`;
  }
  const statusText = (w: (typeof WINDOWS)[number]) => {
    const s = state(w);
    if (s === 'open') return `Open now · ${fmt(w.start + OPEN_SECS - (secs ?? 0))} left`;
    if (s === 'done') return 'Done for today';
    return `Upcoming · in ${fmt(w.start - (secs ?? 0))}`;
  };

  return (
    <Card title="QA release windows">
      <div className={`mono tnum${open ? ' is-live' : ''}`} style={{ ...mono, display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, lineHeight: '28px', fontWeight: 600, minHeight: 28 }} aria-live="polite">
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none', ...mutedText }}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
        <span>{headline ?? <span className="muted">Calculating…</span>}</span>
      </div>
      <ul style={{ listStyle: 'none', margin: 'var(--space-3, 12px) 0', padding: 0, borderTop: '1px solid var(--border, rgba(127,127,127,.25))' }}>
        {WINDOWS.map((w) => (
          <li key={w.label} style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', minHeight: 38, borderBottom: '1px solid var(--border, rgba(127,127,127,.25))' }}>
            <span className="mono tnum" style={{ ...mono, fontSize: 14 }}>{w.label} IST</span>
            <span className="tnum" style={{ fontSize: 13, ...mutedText }}>{secs === null ? '' : statusText(w)}</span>
          </li>
        ))}
      </ul>
      <div style={{ margin: '0 0 var(--space-2, 8px)', padding: '8px 12px', borderLeft: '3px solid var(--warn, #d29922)', background: 'var(--warn-bg, rgba(210,153,34,.12))', borderRadius: '0 var(--r-sm, 6px) var(--r-sm, 6px) 0', fontSize: 13, display: 'flex', flexWrap: 'wrap', columnGap: 8, alignItems: 'baseline' }}>
        <strong style={{ color: 'var(--warn-text, inherit)' }}>Gate: mandatory approval</strong>
        <span className="muted" style={{ overflowWrap: 'anywhere' }} title="DevOps approval required from Prakash Pawar">@pawarprakash-devops</span>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>QA deploys only run in these windows or on manual dispatch</p>
    </Card>
  );
}

export default function ReleaseRadar() {
  return (
    <div className="grid g2" style={{ alignItems: 'start' }}>
      <WaitingToShip />
      <QaWindows />
    </div>
  );
}
