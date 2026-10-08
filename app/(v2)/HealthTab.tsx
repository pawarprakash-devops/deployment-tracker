'use client';
import { useCallback, useEffect, useState } from 'react';
import { Card, Chip, EnvDot, Empty, ErrorNote, Pill, Skeleton, ago, fmtDateTime, type Tone } from './ui';

interface EnvHealth {
  id: string;
  environment: string;
  is_production: boolean;
  display_order: number;
  deployment_type: string | null;
  branch: string | null;
  version: string | null;
  deployed_by: string | null;
  last_deployed_at: string | null;
  duration_seconds: number | null;
}
interface Probe {
  environment: string;
  url: string;
  status: 'HEALTHY' | 'DEGRADED' | 'OFFLINE';
  statusCode: number | null;
  latencyMs: number;
  message: string;
  checkedAt: string;
}
interface ProbeResponse { probed_at: string; clusters: Probe[]; by_environment: Record<string, Probe> }

const PROBE_TONE: Record<Probe['status'], Tone> = { HEALTHY: 'ok', DEGRADED: 'warn', OFFLINE: 'bad' };

// Same day thresholds as the legacy /health page.
function freshness(iso: string | null): { label: string; tone: Tone; days: number | null } {
  if (!iso) return { label: 'Never deployed', tone: 'neutral', days: null };
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return { label: 'Fresh', tone: 'ok', days };
  if (days <= 7) return { label: 'Current', tone: 'info', days };
  if (days <= 30) return { label: 'Aging', tone: 'warn', days };
  return { label: 'Stale', tone: 'bad', days };
}
const duration = (s: number | null) => (s ? `${Math.floor(s / 60)}m ${s % 60}s` : '—');
const hostOf = (u: string) => { try { return new URL(u).host; } catch { return u; } };
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour12: false });

export default function HealthTab() {
  const [envs, setEnvs] = useState<EnvHealth[] | null>(null);
  const [probes, setProbes] = useState<ProbeResponse | null>(null);
  const [envErr, setEnvErr] = useState<string | null>(null);
  const [probeErr, setProbeErr] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    const get = async <T,>(url: string): Promise<T> => {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as T;
    };
    const [a, b] = await Promise.allSettled([get<EnvHealth[]>('/api/health'), get<ProbeResponse>('/api/cluster-health')]);
    if (a.status === 'fulfilled' && Array.isArray(a.value)) { setEnvs(a.value); setEnvErr(null); setUpdatedAt(Date.now()); }
    else setEnvErr(a.status === 'rejected' ? String(a.reason?.message ?? a.reason) : 'Unexpected response');
    if (b.status === 'fulfilled' && Array.isArray(b.value?.clusters)) { setProbes(b.value); setProbeErr(null); setUpdatedAt(Date.now()); }
    else setProbeErr(b.status === 'rejected' ? String(b.reason?.message ?? b.reason) : 'Unexpected response');
    setBusy(false);
  }, []);

  useEffect(() => {
    const run = () => { if (document.visibilityState === 'visible') void load(); };
    run();
    const t = setInterval(run, 90_000);
    window.addEventListener('tracker:refresh', run);
    window.addEventListener('tracker:data-changed', run);
    document.addEventListener('visibilitychange', run);
    return () => {
      clearInterval(t);
      window.removeEventListener('tracker:refresh', run);
      window.removeEventListener('tracker:data-changed', run);
      document.removeEventListener('visibilitychange', run);
    };
  }, [load]);

  const rows = [...(envs ?? [])].sort((x, y) => x.display_order - y.display_order);
  const probeFor = (name: string): Probe | undefined =>
    probes?.by_environment[name] ?? probes?.clusters.find((p) => p.environment.toLowerCase() === name.toLowerCase());
  const count = (s: Probe['status']) => rows.filter((e) => probeFor(e.environment)?.status === s).length;
  const stale = rows.filter((e) => freshness(e.last_deployed_at).label === 'Stale').length;
  const loading = envs === null && probes === null && !envErr && !probeErr;

  return (
    <div>
      <div className="page-h" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1>Environment health</h1>
          <p>
            {probes ? <><strong>{count('HEALTHY')} healthy, {count('DEGRADED')} degraded, {count('OFFLINE')} offline</strong> from live probes</> : 'Live probes unavailable'}
            {envs && <> · {stale} stale environment{stale === 1 ? '' : 's'}</>}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="subtle tnum" aria-live="polite">{updatedAt ? `updated ${clock(updatedAt)}` : 'not updated yet'}</span>
          <button type="button" className="btn" onClick={() => void load()} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </div>

      {envErr && <ErrorNote>Deploy details failed to load ({envErr}); showing the last data received.</ErrorNote>}
      {probeErr && <ErrorNote>Live probes failed to load ({probeErr}); showing the last data received.</ErrorNote>}

      <Card title="Environments" action={<span className="subtle">Polls every 90 s while visible</span>}>
        {loading ? <Skeleton rows={5} /> : rows.length === 0 ? <Empty>No environments to show.</Empty> : (
          <table style={{ minWidth: 860 }}>
            <thead>
              <tr><th>Environment</th><th>Live probe</th><th>Freshness</th><th>Last successful deploy</th><th>Deployed by</th></tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const p = probeFor(e.environment);
                const f = freshness(e.last_deployed_at);
                return (
                  <tr key={e.id}>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <EnvDot tone={p ? PROBE_TONE[p.status] : 'neutral'} label={p ? p.status.toLowerCase() : 'not probed'} />
                        <strong>{e.environment}</strong>
                        {e.is_production && <Pill tone="bad" icon={false}>PROD</Pill>}
                      </span>
                    </td>
                    <td>
                      {p ? (
                        <>
                          <Pill tone={PROBE_TONE[p.status]}>{p.status[0] + p.status.slice(1).toLowerCase()}</Pill>{' '}
                          <span className="tnum">{p.latencyMs} ms</span>
                          {p.statusCode != null && <> · <span className="tnum">HTTP {p.statusCode}</span></>}
                          <div className="subtle" style={{ overflowWrap: 'anywhere' }}>{p.message}</div>
                          <div className="subtle" title={p.url}>{hostOf(p.url)} · checked <span title={fmtDateTime(p.checkedAt)}>{ago(p.checkedAt)}</span></div>
                        </>
                      ) : <span className="muted">{probes ? 'Not probed' : '—'}</span>}
                    </td>
                    <td>
                      <Pill tone={f.tone}>{f.label}</Pill>
                      {f.days != null && f.days > 0 && <div className="subtle tnum">{f.days}d since deploy</div>}
                    </td>
                    <td>
                      {e.last_deployed_at ? (
                        <>
                          <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                            <Chip title={e.version ?? undefined}>{e.version ? e.version.slice(0, 12) : 'no version'}</Chip>
                            {e.deployment_type && <Pill tone={e.deployment_type === 'hotfix' ? 'bad' : e.deployment_type === 'rollback' ? 'warn' : 'neutral'} icon={false}>{e.deployment_type}</Pill>}
                          </span>
                          <div className="subtle">{e.branch ?? '—'} · {duration(e.duration_seconds)}</div>
                          <div className="subtle" title={fmtDateTime(e.last_deployed_at)}>{ago(e.last_deployed_at)}</div>
                        </>
                      ) : <span className="muted">Never deployed</span>}
                    </td>
                    <td>{e.deployed_by ?? <span className="muted">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
