'use client';
import { useEffect, useState } from 'react';
import { Card, Chip, Empty, Pill, Skeleton, ago } from './ui';

type Which = 'backend' | 'frontend';
interface Commit { sha: string; message: string; author?: string; url: string }
interface Promotion { number: number; url: string; mergedAt: string }
interface Pair { baseRef?: string; from: string; to: string; fromEnv: string; toEnv: string; basis?: 'promotion-pr' | 'branch-compare'; promotion?: Promotion; pending?: number; error?: string }
interface Detail { loading: boolean; error?: string; commits: Commit[]; total: number; truncated: boolean; compareUrl?: string }

const SHOWN = 30;
const RR_CSS = '.rr-item:hover > .rr-row{background:rgba(127,127,127,.09)}.rr-btn:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px;border-radius:4px}';
const WINDOWS = [{ label: '1:30 PM', start: 13.5 * 3600 }, { label: '4:00 PM', start: 16 * 3600 }];
const OPEN_SECS = 15 * 60; // a window stays open for 15 minutes (matches the legacy countdown)

// Seconds since midnight in IST (fixed UTC+5:30, no DST).
const istSecs = (ms: number) => Math.floor((ms + 5.5 * 3600_000) / 1000) % 86400;
const fmt = (s: number) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h > 0 ? `${h}h ${m}m` : `${m}m`; };

function PromotionRadar() {
  const [which, setWhich] = useState<Which>('backend');
  const [pairs, setPairs] = useState<Pair[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch(`/api/drift?repo=${which}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((d) => { if (!alive) return; if (d.error || !Array.isArray(d.pairs)) setFailed(true); else { setFailed(false); setPairs(d.pairs); } })
        .catch(() => { if (alive) setFailed(true); });
    };
    load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 300_000);
    return () => { alive = false; clearInterval(t); };
  }, [which]);

  const choose = (w: Which) => { setWhich(w); setPairs(null); setFailed(false); setOpen(null); setDetail(null); setFilter(''); };

  const toggle = (p: Pair) => {
    const k = `${p.from}>${p.to}`;
    setFilter('');
    if (open === k) { setOpen(null); setDetail(null); return; }
    setOpen(k);
    setDetail({ loading: true, commits: [], total: p.pending ?? 0, truncated: false });
    const fail = (error: string) => setDetail({ loading: false, error, commits: [], total: p.pending ?? 0, truncated: false });
    fetch(`/api/drift/commits?repo=${which}&base=${encodeURIComponent(p.baseRef || p.to)}&head=${encodeURIComponent(p.from)}`)
      .then((r) => r.json())
      .then((d) => (d.error ? fail(String(d.error)) : setDetail({ loading: false, commits: d.commits ?? [], total: d.total ?? 0, truncated: !!d.truncated, compareUrl: d.compareUrl })))
      .catch((e) => fail(e instanceof Error ? e.message : 'Failed to load'));
  };

  const toggles = (
    <div style={{ display: 'flex', gap: 6 }}>
      {(['backend', 'frontend'] as const).map((w) => (
        <button key={w} type="button" className="btn" aria-pressed={which === w} onClick={() => choose(w)}>{w === 'backend' ? 'Backend' : 'Frontend'}</button>
      ))}
    </div>
  );

  return (
    <Card title="Promotion radar" action={toggles}>
      <style>{RR_CSS}</style>
      <p className="muted" style={{ margin: '0 0 var(--space-3)', fontSize: 13 }}>+N commits since the last merged promotion PR; ~N means no promotion PR was found so it can over-count.</p>
      {failed && <Empty>Promotion drift is unavailable (needs GH_TOKEN)</Empty>}
      {!failed && !pairs && <Skeleton rows={3} />}
      {!failed && pairs && pairs.length === 0 && <Empty>No promotion pairs configured.</Empty>}
      {!failed && pairs && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, borderTop: '1px solid var(--border)' }}>
          {pairs.map((p) => {
            const k = `${p.from}>${p.to}`;
            const isOpen = open === k;
            const pending = p.pending ?? 0;
            const shown = detail?.commits.filter((c) => !filter || `${c.message} ${c.author ?? ''}`.toLowerCase().includes(filter.toLowerCase())).slice(0, SHOWN) ?? [];
            const label = <span style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap' }}>{p.fromEnv} → {p.toEnv}</span>;
            const mutedAge = { fontSize: 13, color: 'var(--muted)', whiteSpace: 'nowrap' } as const;
            return (
              <li key={k} className="rr-item" style={{ borderBottom: '1px solid var(--border)' }}>
                {p.error ? (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: 40, padding: '0 8px', flexWrap: 'wrap' }} title={p.error}>
                    {label}<span className="muted" style={{ fontSize: 13 }}>unavailable</span>
                  </div>
                ) : (
                  <div className="rr-row" style={{ display: 'flex', alignItems: 'center', minHeight: 40, padding: '0 8px', columnGap: 10, flexWrap: 'wrap' }}>
                    <button type="button" className="rr-btn" onClick={() => toggle(p)} aria-expanded={isOpen} style={{ all: 'unset', boxSizing: 'border-box', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center', minHeight: 40 }}>
                      {label}
                      <Pill tone={pending === 0 ? 'ok' : 'warn'}>{pending === 0 ? 'in sync' : `${p.basis === 'branch-compare' ? '~' : '+'}${pending}`}</Pill>
                    </button>
                    {p.promotion && (
                      <a href={p.promotion.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>Last promotion PR #{p.promotion.number} ↗</a>
                    )}
                    <button type="button" tabIndex={-1} aria-hidden="true" onClick={() => toggle(p)} style={{ all: 'unset', boxSizing: 'border-box', cursor: 'pointer', flex: '1 1 0', minWidth: 60, minHeight: 40, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end', ...mutedAge }}>
                      <span>{p.promotion ? `· ${ago(p.promotion.mergedAt)}` : 'no promotion PR'}</span>
                      <span style={{ fontSize: 12 }}>{isOpen ? '▴' : '▾'}</span>
                    </button>
                  </div>
                )}
                {isOpen && detail && (
                  <div style={{ padding: '0 8px 12px' }}>
                    {detail.loading && <Skeleton rows={3} />}
                    {detail.error && <Empty>Could not load commits ({detail.error}).</Empty>}
                    {!detail.loading && !detail.error && detail.commits.length === 0 && <Empty>No pending commits.</Empty>}
                    {!detail.loading && detail.commits.length > 0 && (
                      <>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '4px 0 8px' }}>
                          <input type="search" className="search" aria-label="Filter commits" placeholder="Filter by message or author" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
                          {detail.compareUrl && <a href={detail.compareUrl} target="_blank" rel="noopener noreferrer">Open compare ↗</a>}
                        </div>
                        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4, fontSize: 'var(--fs-sm)', maxHeight: 360, overflowY: 'auto' }}>
                          {shown.map((c) => (
                            <li key={c.sha}><a href={c.url} target="_blank" rel="noopener noreferrer"><Chip>{c.sha}</Chip></a> {c.message} {c.author && <span className="muted">· {c.author}</span>}</li>
                          ))}
                          {shown.length === 0 && <li className="muted">No commits match the filter.</li>}
                        </ul>
                        {(detail.truncated || detail.total > SHOWN) && (
                          <p className="muted" style={{ margin: '8px 0 0', fontSize: 'var(--fs-sm)' }}>Showing the newest {Math.min(SHOWN, detail.commits.length)} of {detail.total}{detail.truncated ? ' (list truncated by GitHub)' : ''}.</p>
                        )}
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
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
    if (open) headline = `${open.label} IST window is open, ${fmt(open.start + OPEN_SECS - secs)} left`;
    else if (next) headline = `Next: ${next.label} IST in ${fmt(next.start - secs)}`;
    else headline = `Next: tomorrow 1:30 PM IST in ${fmt(86400 + WINDOWS[0].start - secs)}`;
  }

  return (
    <Card title="QA release windows">
      <div className="tnum" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 20, lineHeight: '28px', fontWeight: 600, minHeight: 28 }} aria-live="polite">
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none', color: 'var(--muted)' }}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
        <span>{headline ?? <span className="muted">Calculating…</span>}</span>
      </div>
      <ul style={{ listStyle: 'none', margin: 'var(--space-3) 0', padding: 0, borderTop: '1px solid var(--border)' }}>
        {WINDOWS.map((w) => {
          const s = state(w);
          return (
            <li key={w.label} style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', minHeight: 38, borderBottom: '1px solid var(--border)' }}>
              <span className="tnum" style={{ fontSize: 14 }}>{w.label} IST</span>
              {secs !== null && <Pill tone={s === 'done' ? 'neutral' : s === 'open' ? 'info' : 'warn'}>{s === 'done' ? 'done' : s === 'open' ? 'open now' : 'upcoming'}</Pill>}
            </li>
          );
        })}
      </ul>
      <div style={{ margin: '0 0 var(--space-2)', padding: '8px 12px', borderLeft: '3px solid var(--warn)', background: 'var(--warn-bg)', borderRadius: '0 var(--r-sm) var(--r-sm) 0', fontSize: 13, display: 'flex', flexWrap: 'wrap', columnGap: 8, alignItems: 'baseline' }}>
        <strong style={{ color: 'var(--warn-text)' }}>Gate: mandatory approval</strong>
        <span className="muted" style={{ overflowWrap: 'anywhere' }} title="DevOps approval required from Prakash Pawar">@pawarprakash-devops</span>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>QA deploys only run in these windows or on manual dispatch</p>
    </Card>
  );
}

export default function ReleaseRadar() {
  return (
    <div className="grid g2" style={{ alignItems: 'start' }}>
      <PromotionRadar />
      <QaWindows />
    </div>
  );
}
