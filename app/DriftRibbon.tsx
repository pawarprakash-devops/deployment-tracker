'use client';

import { useEffect, useState } from 'react';

interface Commit { sha: string; message: string; author?: string; url: string; date?: string }
interface Promotion { number: number; url: string; mergedAt: string }
interface Pair { from: string; to: string; fromEnv: string; toEnv: string; basis?: 'promotion-pr' | 'branch-compare'; promotion?: Promotion; status?: string; pending?: number; behind?: number; commits?: Commit[]; error?: string }

const ago = (iso: string) => { const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d}d ago`; };

// "Promotion radar": how many commits each pipeline stage is ahead of the next one.
export default function DriftRibbon() {
  const [which, setWhich] = useState<'frontend' | 'backend'>('backend');
  const [pairs, setPairs] = useState<Pair[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setPairs(null); setError(''); setOpen(null);
    fetch(`/api/drift?repo=${which}`).then((r) => r.json()).then((d) => { if (!alive) return; if (d.error) setError(d.error); else setPairs(d.pairs); }).catch((e) => alive && setError(String(e)));
    return () => { alive = false; };
  }, [which]);

  const active = pairs?.find((p) => `${p.from}>${p.to}` === open);
  return (
    <div className="drift">
      <div className="drift-head">
        <span className="drift-title">PROMOTION RADAR</span>
        <span className="drift-sub">commits waiting to be promoted to the next environment</span>
        <span className="drift-toggle">
          {(['backend', 'frontend'] as const).map((w) => <button key={w} className={which === w ? 'on' : ''} onClick={() => setWhich(w)}>{w === 'backend' ? 'Backend' : 'Frontend'}</button>)}
        </span>
      </div>
      <div className="drift-sub" style={{ marginTop: 8 }}>“+N” counts commits on the upstream branch since the last merged promotion PR. “~N” = no promotion PR found (e.g. Ankura prod is updated by cherry-picks), so it can over-count.</div>
      {error && <div className="drift-err">Drift unavailable: {error}</div>}
      {!pairs && !error && <div className="drift-sub">Loading…</div>}
      {pairs && (
        <div className="drift-row">
          {pairs.map((p) => {
            const k = `${p.from}>${p.to}`;
            const sync = !p.error && (p.pending ?? 0) === 0;
            return (
              <button key={k} className={`drift-chip ${p.error ? 'err' : sync ? 'sync' : 'pend'} ${open === k ? 'sel' : ''}`} onClick={() => setOpen(open === k ? null : k)} disabled={!!p.error || sync}
                title={p.error ? p.error : p.promotion ? `${p.from} → ${p.to}: commits on ${p.from} since promotion PR #${p.promotion.number} (${ago(p.promotion.mergedAt)})` : `${p.from} → ${p.to}: no promotion PR found, plain branch compare (can over-count after squash/merge promotions)`}>
                <span className="drift-env">{p.fromEnv} → {p.toEnv}</span>
                <span className="drift-val">{p.error ? 'n/a' : sync ? 'IN SYNC' : `${p.basis === 'branch-compare' ? '~' : '+'}${p.pending} pending`}</span>
                {!p.error && p.promotion && <span className="drift-env">last promoted {ago(p.promotion.mergedAt)}</span>}
              </button>
            );
          })}
        </div>
      )}
      {active?.commits && active.commits.length > 0 && (
        <ul className="drift-list">
          <li className="drift-sub">{active.promotion ? <>Commits on {active.from} since <a href={active.promotion.url} target="_blank" rel="noopener noreferrer">PR #{active.promotion.number}</a> ({ago(active.promotion.mergedAt)})</> : <>~ No promotion PR found for {active.from} → {active.to}; this is a plain branch compare and may over-count.</>}</li>
          {active.commits.map((c) => (
            <li key={c.sha}><a href={c.url} target="_blank" rel="noopener noreferrer">{c.sha}</a> {c.message} <span className="drift-sub">— {c.author}</span></li>
          ))}
          {(active.pending ?? 0) > active.commits.length && <li className="drift-sub">…and {(active.pending ?? 0) - active.commits.length} more</li>}
        </ul>
      )}
      <style jsx>{`
        .drift { background: var(--panel, #1e2737); border: 1px solid var(--border, rgba(255,255,255,.08)); border-radius: 14px; padding: 14px 16px; margin: 0 0 16px; }
        .drift-head { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
        .drift-title { font-size: 11px; letter-spacing: .08em; font-weight: 700; color: var(--faint, #64748b); }
        .drift-sub { font-size: 12px; color: var(--muted, #94a3b8); }
        .drift-toggle { margin-left: auto; display: inline-flex; gap: 4px; }
        .drift-toggle button { background: transparent; color: var(--muted, #94a3b8); border: 1px solid var(--border, rgba(255,255,255,.12)); border-radius: 6px; padding: 3px 10px; font-size: 12px; cursor: pointer; }
        .drift-toggle button.on { color: var(--text, #e8edf5); border-color: var(--accent, #e17e61); }
        .drift-row { display: flex; gap: 8px; flex-wrap: wrap; }
        .drift-chip { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; border-radius: 10px; padding: 8px 12px; border: 1px solid var(--border, rgba(255,255,255,.12)); background: transparent; color: var(--text, #e8edf5); cursor: pointer; text-align: left; }
        .drift-chip:disabled { cursor: default; }
        .drift-env { font-size: 11.5px; color: var(--muted, #94a3b8); }
        .drift-val { font-size: 13px; font-weight: 700; }
        .drift-chip.sync .drift-val { color: var(--ok, #4ade80); }
        .drift-chip.pend .drift-val { color: var(--warn, #fbbf24); }
        .drift-chip.pend { border-color: rgba(251, 191, 36, .35); }
        .drift-chip.sel { box-shadow: 0 0 0 1px var(--accent, #e17e61); }
        .drift-chip.err .drift-val { color: var(--faint, #64748b); }
        .drift-err { color: var(--bad, #f87171); font-size: 12.5px; }
        .drift-list { list-style: none; padding: 0; margin: 10px 0 0; font-size: 12.5px; display: grid; gap: 4px; }
        .drift-list a { font-family: 'JetBrains Mono', monospace; color: var(--accent, #e17e61); text-decoration: none; margin-right: 6px; }
      `}</style>
    </div>
  );
}
