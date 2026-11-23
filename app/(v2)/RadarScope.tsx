'use client';

export interface ScopePair { key: string; fromEnv: string; toEnv: string; pending?: number; error?: string; missingBranch?: string }

// Tilted radar with a rotating sweep: one blip per promotion pair.
// Distance from the centre grows with the number of unpromoted commits (log scale).
export default function RadarScope({ pairs, openKey, onSelect }: { pairs: ScopePair[]; openKey: string | null; onSelect: (key: string) => void }) {
  if (!pairs.length) return null;
  const n = pairs.length;
  return (
    <div className="radar-scope-wrap">
      <div className="radar-scope" role="group" aria-label="Promotion drift radar">
        <div className="radar-scope-sweep" />
        {pairs.map((p, i) => {
          const pending = p.pending ?? 0;
          const state = p.error ? 'bad' : p.missingBranch ? 'mute' : pending > 0 ? 'drift' : 'ok';
          const r = state === 'ok' ? 12 : state === 'mute' || state === 'bad' ? 44 : Math.min(44, 18 + Math.log2(pending + 1) * 5);
          const a = (i / n) * Math.PI * 2 - Math.PI / 2;
          return (
            <button key={p.key} type="button"
              className={`radar-blip is-${state} ${openKey === p.key ? 'is-open' : ''}`}
              style={{ left: `${50 + Math.cos(a) * r}%`, top: `${50 + Math.sin(a) * r}%`, animationDelay: `${(i * 0.37) % 2}s` }}
              onClick={() => onSelect(p.key)}
              title={`${p.fromEnv} → ${p.toEnv}: ${p.error ?? (p.missingBranch ? 'branch not created' : pending ? `${pending} commits pending` : 'in sync')}`}
              aria-label={`${p.fromEnv} to ${p.toEnv}, ${pending} pending`}>
              <b>{state === 'ok' ? '✓' : state === 'drift' ? pending : '!'}</b>
            </button>
          );
        })}
      </div>
      <div className="radar-scope-legend">
        <span><i className="is-ok" /> in sync</span>
        <span><i className="is-drift" /> commits waiting (further out = more)</span>
        <span><i className="is-bad" /> error</span>
        <span className="subtle">Click a blip to open it</span>
      </div>
    </div>
  );
}
