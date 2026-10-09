'use client';
import { useEffect, useMemo, useState } from 'react';
import { useShell } from './ctx';
import { Pill, Chip, AWAITING_GLYPH, AWAITING_TEXT, QUEUED_GLYPH, QUEUED_TEXT, Skeleton, ErrorNote, ago, type Tone } from './ui';

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
type Pipe = NonNullable<ReturnType<typeof useShell>['pipeline']>;
type Col = Pipe['columns'][number];

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

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
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

/* ---------- node ---------- */
const trunc = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } as const;
const MONO = 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)';

function CompRow({ label, c }: { label: 'FE' | 'BE'; c: Comp | undefined }) {
  const refs = c ? [c.branch, c.version && c.version !== c.branch ? c.version : null].filter(Boolean) as string[] : [];
  if (!refs.length) return null;
  return (
    <>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: label === 'FE' ? 'var(--fe-text, var(--accent-text))' : 'var(--be-text, var(--ok-text))' }}>{label}</span>
      <span className="tnum" style={{ ...trunc, fontSize: 12.5, color: 'var(--text)' }} title={refs.join(' · ')}>{refs[0]}</span>
      <span className="muted tnum" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>{c?.at ? ago(c.at) : ''}</span>
    </>
  );
}

function Node({ r, step, p, col, dv, probed }: { r: HealthRow; step: number; p: Probe | undefined; col: Col | undefined; dv: Derived | undefined; probed: boolean }) {
  const failed = !!(col?.health.latest && /fail/i.test(col.health.latest.status));
  const d = dur(r.duration_seconds);
  const special = r.deployment_type && /hotfix|rollback/i.test(r.deployment_type);
  const fe = dv?.fe, be = dv?.be;
  const headline = realVersion(r.version) ?? realVersion(fe?.version) ?? realVersion(be?.version) ?? r.branch ?? r.version ?? 'unknown';
  const host = hostOf(p);
  const hasComp = !!(fe && (fe.branch || fe.version)) || !!(be && (be.branch || be.version));
  const bn = dv?.banner;
  const bt = bn ? (bn.tone === 'neutral' ? 'info' : bn.tone) : null;
  const sep = bn ? bn.text.indexOf(':') : -1;
  const live = !!col?.activeDeploy;
  const queued = !!col?.queuedDeploy; // waiting behind a running deploy: shown separately, never as running
  const awaiting = !!col?.awaitingDeploy; // paused on an approval: shown separately, never as running
  const pills = (live || queued || awaiting || failed || special) && (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {live && <Pill tone="info" icon={false}><span className="is-live" aria-hidden="true" style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: 'var(--info)', marginRight: 5 }} />In progress</Pill>}
      {awaiting && <Pill tone="info" glyph={AWAITING_GLYPH}>{AWAITING_TEXT}</Pill>}
      {queued && <Pill tone="warn" glyph={QUEUED_GLYPH}>{QUEUED_TEXT}</Pill>}
      {failed && <Pill tone="bad">Last deploy failed</Pill>}
      {special && <Pill tone="warn">{r.deployment_type}</Pill>}
    </div>
  );
  const stripe = failed || p?.status === 'OFFLINE' ? 'bad' : p?.status === 'DEGRADED' ? 'warn' : p ? 'ok' : 'border-bright';
  return (
    <article id={`env-${slug(r.environment)}`} className="re-card fade-in" aria-label={r.environment} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', minWidth: 0, height: '100%', overflow: 'hidden', background: 'var(--surface, transparent)', border: '1px solid var(--border)', borderRadius: 'var(--r-md, 8px)', boxShadow: `inset 3px 0 0 var(--${stripe})` }}>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, minWidth: 0 }}>
        <span className="muted tnum" aria-hidden="true" style={{ flex: 'none', width: 22, height: 22, borderRadius: '50%', border: '1px solid var(--border-bright, var(--border))', fontSize: 11.5, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{step}</span>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: '1 1 110px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }} title={r.environment}>{r.environment}</h3>
            {r.is_production && <Chip title="Production environment">PROD</Chip>}
          </div>
          {host && <span style={{ ...trunc, fontSize: 11.5, color: 'var(--faint)' }} title={p?.url ?? host}>{regionOf(host)}</span>}
        </div>
        <div style={{ marginLeft: 'auto', flex: '0 0 auto' }}>
          {p ? <Pill tone={PROBE_TONE[p.status]}>{p.status[0] + p.status.slice(1).toLowerCase()} <span className="tnum">{Math.round(p.latencyMs)} ms</span></Pill>
            : <Pill tone="neutral">{probed ? 'No probe' : 'Probing…'}</Pill>}
        </div>
      </div>
      {bn && bt && (
        <div role="status" style={{ fontSize: 12, padding: '3px 8px', borderLeft: `3px solid var(--${bt})`, background: `var(--${bt}-bg)`, color: `var(--${bt}-text)`, borderRadius: '0 var(--r-sm) var(--r-sm) 0', overflowWrap: 'anywhere' }}>
          {sep > 0 ? <><strong>{bn.text.slice(0, sep)}</strong>{bn.text.slice(sep)}</> : bn.text}
        </div>
      )}
      {r.version || fe || be ? (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
            <span className="mono tnum" style={{ ...trunc, fontFamily: MONO, fontSize: 20, lineHeight: 1.2, fontWeight: 600 }} title={headline}>{headline}</span>
            {r.branch && r.branch !== headline && <span className="muted" style={{ ...trunc, fontSize: 11, padding: '0 6px', borderRadius: 'var(--r-xs)', border: '1px solid var(--border)', flex: '0 1 auto' }} title={r.branch}>{r.branch}</span>}
          </div>
          {pills}
          {hasComp && (
            <div style={{ display: 'grid', gridTemplateColumns: '20px minmax(0, 1fr) auto', columnGap: 8, rowGap: 2, alignItems: 'baseline' }}>
              <CompRow label="FE" c={fe} />
              <CompRow label="BE" c={be} />
            </div>
          )}
          <div style={{ ...trunc, fontSize: 12, color: 'var(--info-text)' }} title={`deployed ${ago(r.last_deployed_at)}${d ? ` · ${d}` : ''}`}>
            deployed {ago(r.last_deployed_at)}{d ? ` · ${d}` : ''}
          </div>
        </>
      ) : (
        <>
          {pills}
          <p className="empty">No deployments yet</p>
        </>
      )}
    </article>
  );
}

/* ---------- layout model ---------- */
// Promotion order: Preview, QA, Demo, Stage*, Pre-Prod*, Production*, LMS, anything else (display_order breaks ties).
const RANK: RegExp[] = [/^preview\b/i, /^qa\b/i, /^demo/i, /^stage\b/i, /^pre-?prod\b/i, /^production/i, /^lms/i];
const rankOf = (env: string) => { const i = RANK.findIndex((t) => t.test(env)); return i < 0 ? RANK.length : i; };

const GRID_CSS = `
.re-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(250px,100%),1fr));gap:12px;align-items:stretch;list-style:none;margin:0;padding:0;width:100%}
.re-grid>li{min-width:0;display:flex;flex-direction:column}
.re-grid>li>article{flex:1 1 auto}
.re-card{transition:border-color .15s}
.re-card:hover{border-color:var(--border-bright,var(--border))!important}
@media (prefers-reduced-motion:reduce){.is-live{animation:none!important}.re-card{transition:none}}
`;

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
      // Independent: a cluster-health failure must never hide the nodes.
      fetch('/api/health', { cache: 'no-store' })
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<HealthRow[]>; })
        .then((j) => { if (alive) { setRows(Array.isArray(j) ? j : []); setErr(null); } })
        .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : 'Failed to load'); });
      fetch('/api/deployments?limit=1000', { cache: 'no-store' })
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<Dep[]>; })
        .then((j) => { if (alive && Array.isArray(j)) setDeps(j); })
        .catch(() => { /* optional enrichment; nodes still render */ });
      fetch('/api/cluster-health', { cache: 'no-store' })
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<ClusterRes>; })
        .then((j) => { if (alive) { setProbes(j); setProbedAt(j.probed_at ?? new Date().toISOString()); } })
        .catch(() => { /* keep last known probes; nodes still render */ });
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
  const ordered = useMemo(() => sorted.map((r, i) => ({ r, i })).sort((a, b) => rankOf(a.r.environment) - rankOf(b.r.environment) || a.i - b.i).map((x) => x.r), [sorted]);
  const derived = useMemo(() => {
    const by = new Map<string, Dep[]>();
    deps.forEach((d) => { const a = by.get(d.environment); if (a) a.push(d); else by.set(d.environment, [d]); });
    const m = new Map<string, Derived>();
    by.forEach((v, k) => m.set(k, derive(v)));
    return m;
  }, [deps]);
  const colFor = (env: string) => pipeline?.columns.find((c) => c.environments.includes(env));

  return (
    <section aria-labelledby="release-envs-h" style={{ minWidth: 0 }}>
      <style>{GRID_CSS}</style>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3, 12px)', flexWrap: 'wrap', marginBottom: 'var(--space-3, 12px)' }}>
        <h2 id="release-envs-h" className="section-h" style={{ fontSize: 'var(--fs-xs)', fontVariant: 'small-caps', textTransform: 'lowercase', letterSpacing: '.08em', color: 'var(--muted)', fontWeight: 600 }}>Environments</h2>
        <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
          {probedAt ? `live probes updated ${new Date(probedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'live probes pending'}
        </span>
        <span className="muted" style={{ fontSize: 'var(--fs-xs)', marginLeft: 'auto' }}>Cards are in promotion order</span>
      </div>
      {err && !rows ? <ErrorNote>Could not load environments ({err}).</ErrorNote>
        : !rows ? <Skeleton rows={3} />
        : (
          <ul className="re-grid">
            {ordered.map((r, i) => (
              <li key={r.environment}>
                <Node r={r} step={i + 1} p={probeMap.get(r.environment)} col={colFor(r.environment)} dv={derived.get(r.environment)} probed={!!probes} />
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}
