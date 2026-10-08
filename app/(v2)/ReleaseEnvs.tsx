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

  const trunc = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } as const;
  const stripe = (p: Probe | undefined, failed: boolean | undefined) => `var(--${failed || p?.status === 'OFFLINE' ? 'bad' : p?.status === 'DEGRADED' ? 'warn' : p ? 'ok' : 'border-bright'})`;
  const compRow = (label: string, c: Comp | undefined) => {
    const refs = c ? [c.branch, c.version && c.version !== c.branch ? c.version : null].filter(Boolean) as string[] : [];
    if (!refs.length) return null;
    return (
      <>
        <span style={{ fontSize: 12, fontWeight: 700, color: label === 'FE' ? 'var(--accent-text)' : 'var(--ok-text)' }}>{label}</span>
        <span className="tnum" style={{ ...trunc, fontSize: 13, color: 'var(--text)' }} title={refs.join(' · ')}>{refs[0]}{refs.length > 1 ? ` +${refs.length - 1}` : ''}</span>
        <span className="muted tnum" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{c?.at ? ago(c.at) : ''}</span>
      </>
    );
  };

  return (
    <section className="card" aria-labelledby="release-envs-h">
      <style>{'.env-card{transition:border-color .15s}.env-card:hover{border-color:var(--border-bright)}'}</style>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
        <h2 id="release-envs-h" style={{ fontSize: 'var(--fs-xs)', fontVariant: 'small-caps', textTransform: 'lowercase', letterSpacing: '.08em', color: 'var(--muted)', fontWeight: 600 }}>Environments</h2>
        <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
          {probedAt ? `live probes updated ${new Date(probedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'live probes pending'}
        </span>
      </div>
      {err && !rows ? <ErrorNote>Could not load environments ({err}).</ErrorNote>
        : !rows ? <Skeleton rows={3} />
        : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(230px, 100%), 1fr))', gap: 12, alignItems: 'start' }}>
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
              const hasComp = !!(fe && (fe.branch || fe.version)) || !!(be && (be.branch || be.version));
              const bn = dv?.banner;
              const bt = bn ? (bn.tone === 'neutral' ? 'info' : bn.tone) : null;
              const sep = bn ? bn.text.indexOf(':') : -1;
              const hasPills = !!(col?.activeDeploy || failed || special);
              return (
                <li key={r.environment} className="card env-card" style={{ display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden', minWidth: 0, boxShadow: `inset 3px 0 0 ${stripe(p, !!failed)}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, minWidth: 0 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: '1 1 150px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        <h3 style={{ fontSize: 14.5, fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }} title={r.environment}>{r.environment}</h3>
                        {r.is_production && <Chip title="Production environment">PROD</Chip>}
                      </div>
                      {host && <span style={{ ...trunc, fontSize: 12, color: 'var(--faint)' }} title={p?.url ?? host}>{regionOf(host)}</span>}
                    </div>
                    <div style={{ marginLeft: 'auto', flex: '0 0 auto' }}>
                      {p ? <Pill tone={PROBE_TONE[p.status]}>{p.status[0] + p.status.slice(1).toLowerCase()} <span className="tnum">{Math.round(p.latencyMs)} ms</span></Pill>
                        : <Pill tone="neutral">{probes ? 'No probe' : 'Probing…'}</Pill>}
                    </div>
                  </div>
                  {bn && bt && (
                    <div role="status" style={{ fontSize: 12.5, padding: '4px 8px', borderLeft: `3px solid var(--${bt})`, background: `var(--${bt}-bg)`, color: `var(--${bt}-text)`, borderRadius: '0 var(--r-sm) var(--r-sm) 0', overflowWrap: 'anywhere' }}>
                      {sep > 0 ? <><strong>{bn.text.slice(0, sep)}</strong>{bn.text.slice(sep)}</> : bn.text}
                    </div>
                  )}
                  {r.version || fe || be ? (
                    <>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                        <span className="tnum" style={{ ...trunc, fontSize: 20, lineHeight: 1.2, fontWeight: 600 }} title={headline}>{headline}</span>
                        {r.branch && r.branch !== headline && <span className="muted" style={{ ...trunc, fontSize: 11.5, padding: '1px 6px', borderRadius: 'var(--r-xs)', border: '1px solid var(--border)', flex: '0 1 auto' }} title={r.branch}>{r.branch}</span>}
                      </div>
                      {hasPills && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {col?.activeDeploy && <Pill tone="info">In progress</Pill>}
                          {failed && <Pill tone="bad">Last deploy failed</Pill>}
                          {special && <Pill tone="warn">{r.deployment_type}</Pill>}
                        </div>
                      )}
                      {hasComp && (
                        <div style={{ display: 'grid', gridTemplateColumns: '22px minmax(0, 1fr) auto', columnGap: 8, rowGap: 2, alignItems: 'baseline' }}>
                          {compRow('FE', fe)}
                          {compRow('BE', be)}
                        </div>
                      )}
                      <div style={{ ...trunc, fontSize: 12.5, color: 'var(--info-text)' }} title={`deployed ${ago(r.last_deployed_at)}${d ? ` · ${d}` : ''}`}>
                        deployed {ago(r.last_deployed_at)}{d ? ` · ${d}` : ''}
                      </div>
                    </>
                  ) : (
                    <>
                      {hasPills && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {col?.activeDeploy && <Pill tone="info">In progress</Pill>}
                          {failed && <Pill tone="bad">Last deploy failed</Pill>}
                          {special && <Pill tone="warn">{r.deployment_type}</Pill>}
                        </div>
                      )}
                      <p className="empty">No deployments yet</p>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
    </section>
  );
}
