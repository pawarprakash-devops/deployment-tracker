'use client';
import { useEffect, useMemo, useState } from 'react';
import { useShell } from './ctx';
import { Pill, Chip, Skeleton, ErrorNote, ago, type Tone } from './ui';

interface HealthRow {
  environment: string; is_production: boolean; display_order: number; status: string | null;
  deployment_type: string | null; branch: string | null; version: string | null; deployed_by: string | null;
  last_deployed_at: string | null; duration_seconds: number | null;
}
interface Probe { environment: string; status: 'HEALTHY' | 'DEGRADED' | 'OFFLINE'; latencyMs: number; message?: string; url?: string; host?: string }
interface Dep {
  environment: string; status: string; branch?: string | null; version?: string | null;
  frontend_branch?: string | null; backend_branch?: string | null; frontend_version?: string | null; backend_version?: string | null;
  notes?: string | null; started_at: string; created_at?: string | null; completed_at?: string | null;
}
interface Comp { branch: string | null; version: string | null; at: string | null }
interface Derived { fe: Comp; be: Comp; banner: { tone: Tone; text: string } | null }
interface ClusterRes { probed_at?: string; clusters?: Probe[]; by_environment?: Record<string, Probe> }

const PROBE_TONE: Record<Probe['status'], Tone> = { HEALTHY: 'ok', DEGRADED: 'warn', OFFLINE: 'bad' };

function dur(s: number | null): string | null {
  if (s == null || !Number.isFinite(s)) return null;
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}m ${t % 60}s`;
}

const isOk = (st: string) => /^(rerun - )?success$/i.test(st);
const isFail = (st: string) => /^(rerun - )?fail/i.test(st);
const SEMVER = /^v?\d+\.\d+\.\d+([-+][\w.-]+)?$/;
const realVersion = (v?: string | null) => (v && SEMVER.test(v.trim()) && !/^v?0\.0\.0$/.test(v.trim()) ? v.trim() : null);

function regionOf(host: string): string {
  const l = host.toLowerCase();
  if (/euw2|eu-west-2|london/.test(l)) return 'eu-west-2';
  if (/usw2|usw|us-west-2/.test(l)) return 'us-west-2';
  if (/use1|us-east-1/.test(l)) return 'us-east-1';
  return 'ap-south-1';
}
function hostOf(p?: Probe): string | null {
  if (!p) return null;
  if (p.host) return p.host;
  if (!p.url) return null;
  try { return new URL(p.url).hostname; } catch { return null; }
}

const ts = (d: Dep) => new Date(d.started_at).getTime() || 0;

function derive(deps: Dep[]): Derived {
  const sorted = deps.slice().sort((a, b) => ts(b) - ts(a) || (new Date(b.created_at || b.completed_at || 0).getTime() - new Date(a.created_at || a.completed_at || 0).getTime()));
  const okRows = sorted.filter((d) => isOk(d.status));
  const comp = (kind: 'frontend' | 'backend'): Comp => {
    const re = kind === 'frontend' ? /Component:\s*frontend/i : /Component:\s*backend/i;
    const bk = kind === 'frontend' ? 'frontend_branch' : 'backend_branch';
    const vk = kind === 'frontend' ? 'frontend_version' : 'backend_version';
    const row = okRows.find((d) => d[bk] || d[vk] || (d.notes && re.test(d.notes)));
    if (!row) return { branch: null, version: null, at: null };
    const noted = !!(row.notes && re.test(row.notes));
    return { branch: row[bk] || (noted ? row.branch ?? null : null), version: row[vk] || (noted ? row.version ?? null : null), at: row.started_at };
  };
  let banner: Derived['banner'] = null;
  if (sorted.length) {
    let fails = 0;
    for (const d of sorted) { if (isFail(d.status)) fails++; else break; }
    const lastOk = okRows[0];
    const days = lastOk ? Math.floor((Date.now() - ts(lastOk)) / 86_400_000) : null;
    if (fails >= 3) banner = { tone: 'bad', text: `Critical: ${fails} failures in a row${lastOk ? ` since the last success ${ago(lastOk.started_at)}` : ''}` };
    else if (fails >= 2) banner = { tone: 'warn', text: `Warning: ${fails} failures in a row${lastOk ? ` since the last success ${ago(lastOk.started_at)}` : ''}` };
    else if (!lastOk) banner = { tone: 'warn', text: 'Warning: no successful deploy recorded' };
    else if (days !== null && days > 30) banner = { tone: 'warn', text: `Warning: stale, no successful deploy for ${days} days` };
    else if (days !== null && days > 14) banner = { tone: 'neutral', text: `Notice: aging, no successful deploy for ${days} days` };
  }
  return { fe: comp('frontend'), be: comp('backend'), banner };
}

export default function ReleaseEnvs() {
  const { pipeline } = useShell();
  const [rows, setRows] = useState<HealthRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [probes, setProbes] = useState<ClusterRes | null>(null);
  const [probedAt, setProbedAt] = useState<string | null>(null);
  const [deps, setDeps] = useState<Dep[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      // Independent: a cluster-health failure must never hide the cards.
      fetch('/api/health', { cache: 'no-store' })
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<HealthRow[]>; })
        .then((j) => { if (alive) { setRows(Array.isArray(j) ? j : []); setErr(null); } })
        .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : 'Failed to load'); });
      fetch('/api/deployments?limit=1000', { cache: 'no-store' })
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<Dep[]>; })
        .then((j) => { if (alive && Array.isArray(j)) setDeps(j); })
        .catch(() => { /* optional enrichment; cards still render */ });
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
  const derived = useMemo(() => {
    const by = new Map<string, Dep[]>();
    deps.forEach((d) => { const a = by.get(d.environment); if (a) a.push(d); else by.set(d.environment, [d]); });
    const m = new Map<string, Derived>();
    by.forEach((v, k) => m.set(k, derive(v)));
    return m;
  }, [deps]);
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
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))', gap: 12, alignItems: 'stretch' }}>
            {sorted.map((r) => {
              const p = probeMap.get(r.environment);
              const col = colFor(r.environment);
              const failed = col?.health.latest && /fail/i.test(col.health.latest.status);
              const d = dur(r.duration_seconds);
              const special = r.deployment_type && /hotfix|rollback/i.test(r.deployment_type);
              const dv = derived.get(r.environment);
              const fe = dv?.fe, be = dv?.be;
              const headline = realVersion(r.version) ?? realVersion(fe?.version) ?? realVersion(be?.version) ?? r.branch ?? r.version ?? 'unknown';
              const host = hostOf(p);
              const feText = fe && (fe.branch || fe.version) ? [fe.branch, fe.version && fe.version !== fe.branch ? fe.version : null].filter(Boolean).join(' · ') : null;
              const beText = be && (be.branch || be.version) ? [be.branch, be.version && be.version !== be.branch ? be.version : null].filter(Boolean).join(' · ') : null;
              const wrap = { overflowWrap: 'anywhere' as const, minWidth: 0 };
              return (
                <li key={r.environment} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', overflow: 'hidden', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <h3 style={{ fontSize: 'var(--fs-base)', fontWeight: 600, overflowWrap: 'anywhere' }}>{r.environment}</h3>
                    {r.is_production && <Chip title="Production environment">PROD</Chip>}
                  </div>
                  {host && <div className="muted" style={{ fontSize: 'var(--fs-xs)', ...wrap }} title={p?.url}>{regionOf(host)} · {host}</div>}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', minHeight: 22 }}>
                    {p ? <Pill tone={PROBE_TONE[p.status]}>{p.status[0] + p.status.slice(1).toLowerCase()} · <span className="tnum">{Math.round(p.latencyMs)} ms</span></Pill>
                      : <Pill tone="neutral">{probes ? 'No probe' : 'Probing…'}</Pill>}
                    {col?.activeDeploy && <Pill tone="info">In progress</Pill>}
                    {failed && <Pill tone="bad">Last deploy failed</Pill>}
                    {special && <Pill tone="warn">{r.deployment_type}</Pill>}
                  </div>
                  {dv?.banner && <div role="status" style={{ fontSize: 'var(--fs-xs)', ...wrap, padding: '4px 8px', borderRadius: 'var(--r-sm)', color: `var(--${dv.banner.tone}-text)`, background: `var(--${dv.banner.tone}-bg)`, border: `1px solid var(--${dv.banner.tone}-border)` }}>{dv.banner.text}</div>}
                  {r.version || fe || be ? (
                    <>
                      <div className="tnum" style={{ fontSize: 'var(--fs-xl)', lineHeight: 'var(--lh-xl)', fontWeight: 600, ...wrap }}>{headline}</div>
                      {(feText || beText) ? (
                        <div className="tnum" style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', columnGap: 8, rowGap: 2, fontSize: 'var(--fs-xs)' }}>
                          {feText && <><span className="muted">FE</span><span style={wrap}>{feText}</span></>}
                          {beText && <><span className="muted">BE</span><span style={wrap}>{beText}</span></>}
                        </div>
                      ) : <div className="muted" style={{ fontSize: 'var(--fs-xs)', ...wrap }}>{r.branch ?? 'unknown branch'}</div>}
                      <div className="muted" style={{ fontSize: 'var(--fs-xs)', ...wrap, marginTop: 'auto' }}>
                        deployed {ago(r.last_deployed_at)}{r.deployed_by ? ` by ${r.deployed_by}` : ''}{d ? ` · ${d}` : ''}
                        {fe?.at && <><br />last FE deploy {ago(fe.at)}</>}
                        {be?.at && <><br />last BE deploy {ago(be.at)}</>}
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
