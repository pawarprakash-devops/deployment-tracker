'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  Server,
  Globe,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Layers,
  ExternalLink,
  Filter,
  Radio,
  Cpu,
} from 'lucide-react';
import { useShell } from './ctx';
import { StatusPill, Chip, ago, formatDuration } from './ui';

interface HealthRow {
  environment: string;
  is_production: boolean;
  display_order: number;
  status: string | null;
  deployment_type: string | null;
  branch: string | null;
  version: string | null;
  deployed_by: string | null;
  last_deployed_at: string | null;
  duration_seconds: number | null;
}

interface Probe {
  environment: string;
  status: 'HEALTHY' | 'DEGRADED' | 'OFFLINE';
  latencyMs: number;
  url?: string;
  host?: string;
  region?: string | null;
}

interface Dep {
  environment: string;
  status: string;
  branch?: string | null;
  version?: string | null;
  frontend_branch?: string | null;
  backend_branch?: string | null;
  frontend_version?: string | null;
  backend_version?: string | null;
  notes?: string | null;
  started_at: string;
  created_at?: string | null;
  completed_at?: string | null;
}

interface Comp {
  branch: string | null;
  version: string | null;
  at: string | null;
}

interface Derived {
  fe: Comp;
  be: Comp;
  banner: { tone: 'bad' | 'warn' | 'neutral'; text: string } | null;
}

const isOk = (st: string) => /^(rerun - )?success$/i.test(st);
const isFail = (st: string) => /^(rerun - )?fail/i.test(st);
const SEMVER = /^v?\d+\.\d+\.\d+([-+][\w.-]+)?$/;
const realVersion = (v?: string | null) =>
  v && SEMVER.test(v.trim()) && !/^v?0\.0\.0$/.test(v.trim()) ? v.trim() : null;

function regionOf(envName: string, host?: string): string {
  const l = `${envName} ${host || ''}`.toLowerCase();
  if (/euc|eu-central-1|egypt/.test(l)) return 'eu-central-1';
  if (/usw|us-west-1|citmer/.test(l)) return 'us-west-1';
  if (/euw2|eu-west-2|london/.test(l)) return 'eu-west-2';
  if (/use1|us-east-1/.test(l)) return 'us-east-1';
  return 'ap-south-1';
}

function derive(deps: Dep[]): Derived {
  const sorted = deps
    .slice()
    .sort(
      (a, b) =>
        new Date(b.started_at).getTime() - new Date(a.started_at).getTime() ||
        new Date(b.created_at || b.completed_at || 0).getTime() -
          new Date(a.created_at || a.completed_at || 0).getTime()
    );

  const okRows = sorted.filter((d) => isOk(d.status));

  const comp = (kind: 'frontend' | 'backend'): Comp => {
    const re = kind === 'frontend' ? /Component:\s*frontend/i : /Component:\s*backend/i;
    const bk = kind === 'frontend' ? 'frontend_branch' : 'backend_branch';
    const vk = kind === 'frontend' ? 'frontend_version' : 'backend_version';
    const row = okRows.find((d) => d[bk] || d[vk] || (d.notes && re.test(d.notes)));
    if (!row) return { branch: null, version: null, at: null };
    const noted = !!(row.notes && re.test(row.notes));
    return {
      branch: row[bk] || (noted ? row.branch ?? null : null),
      version: row[vk] || (noted ? row.version ?? null : null),
      at: row.started_at,
    };
  };

  let banner: Derived['banner'] = null;
  if (sorted.length) {
    let fails = 0;
    for (const d of sorted) {
      if (isFail(d.status)) fails++;
      else break;
    }
    const lastOk = okRows[0];
    const days = lastOk ? Math.floor((Date.now() - new Date(lastOk.started_at).getTime()) / 86_400_000) : null;
    if (fails >= 3) {
      banner = { tone: 'bad', text: `${fails} failures in a row` };
    } else if (fails >= 2) {
      banner = { tone: 'warn', text: `${fails} consecutive failures` };
    } else if (!lastOk) {
      banner = { tone: 'warn', text: 'No successful deploy on record' };
    } else if (days !== null && days > 30) {
      banner = { tone: 'warn', text: `Stale: no deploy for ${days}d` };
    }
  }

  return { fe: comp('frontend'), be: comp('backend'), banner };
}

export default function ReleaseEnvs() {
  const { refreshKey, envFilter, setEnvFilter } = useShell();
  const [envs, setEnvs] = useState<HealthRow[] | null>(null);
  const [probes, setProbes] = useState<Record<string, Probe>>({});
  const [derivedMap, setDerivedMap] = useState<Record<string, Derived>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);

    Promise.allSettled([
      fetch('/api/health', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/cluster-health', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/deployments?limit=300', { cache: 'no-store' }).then((r) => r.json()),
    ]).then(([hRes, pRes, dRes]) => {
      if (!alive) return;

      if (hRes.status === 'fulfilled' && Array.isArray(hRes.value)) {
        setEnvs(hRes.value);
      }

      if (pRes.status === 'fulfilled' && pRes.value?.clusters) {
        const map: Record<string, Probe> = {};
        for (const p of pRes.value.clusters as Probe[]) {
          map[p.environment.toLowerCase()] = p;
        }
        setProbes(map);
      }

      if (dRes.status === 'fulfilled' && Array.isArray(dRes.value?.deployments)) {
        const byEnv: Record<string, Dep[]> = {};
        for (const d of dRes.value.deployments as Dep[]) {
          if (!byEnv[d.environment]) byEnv[d.environment] = [];
          byEnv[d.environment].push(d);
        }
        const derived: Record<string, Derived> = {};
        for (const [env, list] of Object.entries(byEnv)) {
          derived[env] = derive(list);
        }
        setDerivedMap(derived);
      }

      setLoading(false);
    });

    return () => {
      alive = false;
    };
  }, [refreshKey]);

  if (loading && !envs) {
    return (
      <div className="envs-section">
        <div className="section-header">
          <h2 className="section-title">Environment Fleet</h2>
        </div>
        <div className="envs-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="env-card is-loading">
              <div className="skeleton-line w-32" />
              <div className="skeleton-line w-20" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const sortedEnvs = (envs || []).slice().sort((a, b) => a.display_order - b.display_order);

  return (
    <div className="envs-section">
      <div className="section-header">
        <div>
          <h2 className="section-title">Environment Fleet</h2>
          <p className="section-subtitle">
            Live cluster health, active runtime versions and deployment status across all tiers
          </p>
        </div>

        {envFilter && (
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => setEnvFilter(null)}
          >
            Clear Filter ({envFilter})
          </button>
        )}
      </div>

      <div className="envs-grid">
        {sortedEnvs.map((env) => {
          const probe = probes[env.environment.toLowerCase()];
          const dv = derivedMap[env.environment];
          const isSelected = envFilter === env.environment;
          const region = regionOf(env.environment, probe?.host);
          const slug = env.environment.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

          // Health status
          const probeStatus = probe?.status ?? 'UNKNOWN';
          const isProbeHealthy = probeStatus === 'HEALTHY';
          const isProbeDegraded = probeStatus === 'DEGRADED';
          const isProbeOffline = probeStatus === 'OFFLINE';

          return (
            <div
              key={env.environment}
              id={`env-${slug}`}
              className={`env-card ${env.is_production ? 'is-production' : ''} ${
                isSelected ? 'is-selected' : ''
              }`}
            >
              {/* Card Top: Name + Badges */}
              <div className="env-card-top">
                <div className="env-title-block">
                  <div className="env-name-row">
                    <Server size={15} className={env.is_production ? 'text-prod' : 'text-accent'} />
                    <h3 className="env-name">{env.environment}</h3>
                  </div>
                  <div className="env-badges-row">
                    <span className="env-region-chip">{region}</span>
                    {env.is_production && <span className="env-prod-chip">PROD</span>}
                  </div>
                </div>

                {/* Live Probe Latency */}
                {probe && (
                  <div
                    className={`env-probe-pill status-${probeStatus.toLowerCase()}`}
                    title={probe.url ? `Probing: ${probe.url}` : undefined}
                  >
                    <span className="probe-dot" />
                    <span className="probe-latency tnum">{probe.latencyMs}ms</span>
                  </div>
                )}
              </div>

              {/* Stale / Failure Warning Banner */}
              {dv?.banner && (
                <div className={`env-card-alert tone-${dv.banner.tone}`}>
                  <AlertTriangle size={12} className="flex-none" />
                  <span>{dv.banner.text}</span>
                </div>
              )}

              {/* Active Versions (FE / BE) */}
              <div className="env-components-box">
                {/* Frontend */}
                <div className="comp-row">
                  <span className="comp-tag is-fe">FE</span>
                  <div className="comp-details">
                    <span className="comp-branch tnum" title={dv?.fe?.branch || env.branch || '—'}>
                      {dv?.fe?.branch || env.branch || '—'}
                    </span>
                    {dv?.fe?.version && realVersion(dv.fe.version) && (
                      <span className="comp-version">{dv.fe.version}</span>
                    )}
                  </div>
                  <span className="comp-time">{dv?.fe?.at ? ago(dv.fe.at) : ''}</span>
                </div>

                {/* Backend */}
                <div className="comp-row">
                  <span className="comp-tag is-be">BE</span>
                  <div className="comp-details">
                    <span className="comp-branch tnum" title={dv?.be?.branch || env.branch || '—'}>
                      {dv?.be?.branch || env.branch || '—'}
                    </span>
                    {dv?.be?.version && realVersion(dv.be.version) && (
                      <span className="comp-version">{dv.be.version}</span>
                    )}
                  </div>
                  <span className="comp-time">{dv?.be?.at ? ago(dv.be.at) : ''}</span>
                </div>
              </div>

              {/* Card Footer: Status + Actions */}
              <div className="env-card-footer">
                <div className="env-deploy-meta">
                  {env.status ? (
                    <StatusPill status={env.status} />
                  ) : (
                    <span className="muted-text">No runs recorded</span>
                  )}
                  {env.last_deployed_at && (
                    <span className="env-deploy-time tnum" title={new Date(env.last_deployed_at).toLocaleString()}>
                      {ago(env.last_deployed_at)}
                    </span>
                  )}
                </div>

                <div className="env-actions">
                  <button
                    type="button"
                    className={`env-filter-btn ${isSelected ? 'is-active' : ''}`}
                    onClick={() => setEnvFilter(isSelected ? null : env.environment)}
                    title="Filter deployment history by this environment"
                  >
                    <Filter size={13} />
                    <span>{isSelected ? 'Filtered' : 'Filter'}</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
