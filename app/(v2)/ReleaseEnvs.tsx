'use client';
import { useEffect, useMemo, useState } from 'react';
import { useShell } from './ctx';
import { Pill, Chip, Skeleton, ErrorNote, ago, type Tone } from './ui';

interface HealthRow {
  environment: string; is_production: boolean; display_order: number; status: string | null;
  deployment_type: string | null; branch: string | null; version: string | null; deployed_by: string | null;
  last_deployed_at: string | null; duration_seconds: number | null;
}
interface Probe { environment: string; status: 'HEALTHY' | 'DEGRADED' | 'OFFLINE'; latencyMs: number; message?: string }
interface ClusterRes { probed_at?: string; clusters?: Probe[]; by_environment?: Record<string, Probe> }

const PROBE_TONE: Record<Probe['status'], Tone> = { HEALTHY: 'ok', DEGRADED: 'warn', OFFLINE: 'bad' };

function dur(s: number | null): string | null {
  if (s == null || !Number.isFinite(s)) return null;
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}m ${t % 60}s`;
}

export default function ReleaseEnvs() {
  const { pipeline } = useShell();
  const [rows, setRows] = useState<HealthRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [probes, setProbes] = useState<ClusterRes | null>(null);
  const [probedAt, setProbedAt] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      // Independent: a cluster-health failure must never hide the cards.
      fetch('/api/health', { cache: 'no-store' })
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<HealthRow[]>; })
        .then((j) => { if (alive) { setRows(Array.isArray(j) ? j : []); setErr(null); } })
        .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : 'Failed to load'); });
      fetch('/api/cluster-health', { cache: 'no-store' })
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<ClusterRes>; })
        .then((j) => { if (alive) { setProbes(j); setProbedAt(j.probed_at ?? new Date().toISOString()); } })
        .catch(() => { /* keep last known probes; cards still render */ });
    };
    load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 90_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const probeMap = useMemo(() => {
    const m = new Map<string, Probe>();
    Object.entries(probes?.by_environment ?? {}).forEach(([k, v]) => m.set(k, v));
    (probes?.clusters ?? []).forEach((c) => m.set(c.environment, c));
    return m;
  }, [probes]);

  const sorted = useMemo(() => (rows ?? []).slice().sort((a, b) => a.display_order - b.display_order), [rows]);
  const colFor = (env: string) => pipeline?.columns.find((c) => c.environments.includes(env));

  return (
    <section aria-labelledby="release-envs-h">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
        <h2 id="release-envs-h" style={{ fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)', fontWeight: 600 }}>Environments</h2>
        <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
          {probedAt ? `live probes updated ${new Date(probedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'live probes pending'}
        </span>
      </div>
      {err && !rows ? <ErrorNote>Could not load environments ({err}).</ErrorNote>
        : !rows ? <Skeleton rows={3} />
        : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(240px, 100%), 1fr))', gap: 12 }}>
            {sorted.map((r) => {
              const p = probeMap.get(r.environment);
              const col = colFor(r.environment);
              const failed = col?.health.latest && /fail/i.test(col.health.latest.status);
              const d = dur(r.duration_seconds);
              const special = r.deployment_type && /hotfix|rollback/i.test(r.deployment_type);
              return (
                <li key={r.environment} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <h3 style={{ fontSize: 'var(--fs-base)', fontWeight: 600, overflowWrap: 'anywhere' }}>{r.environment}</h3>
                    {r.is_production && <Chip title="Production environment">PROD</Chip>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', minHeight: 22 }}>
                    {p ? <Pill tone={PROBE_TONE[p.status]}>{p.status[0] + p.status.slice(1).toLowerCase()} · <span className="tnum">{Math.round(p.latencyMs)} ms</span></Pill>
                      : <Pill tone="neutral">{probes ? 'No probe' : 'Probing…'}</Pill>}
                    {col?.activeDeploy && <Pill tone="info">In progress</Pill>}
                    {failed && <Pill tone="bad">Last deploy failed</Pill>}
                    {special && <Pill tone="warn">{r.deployment_type}</Pill>}
                  </div>
                  {r.version ? (
                    <>
                      <div className="tnum" style={{ fontSize: 'var(--fs-xl)', lineHeight: 'var(--lh-xl)', fontWeight: 600, overflowWrap: 'anywhere' }}>{r.version}</div>
                      <div className="muted" style={{ fontSize: 'var(--fs-xs)', overflowWrap: 'anywhere' }}>{r.branch ?? 'unknown branch'}</div>
                      <div className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
                        deployed {ago(r.last_deployed_at)}{r.deployed_by ? ` by ${r.deployed_by}` : ''}{d ? ` · ${d}` : ''}
                      </div>
                    </>
                  ) : <p className="empty">No deployments yet</p>}
                </li>
              );
            })}
          </ul>
        )}
    </section>
  );
}
