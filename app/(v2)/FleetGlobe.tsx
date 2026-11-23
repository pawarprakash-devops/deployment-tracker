'use client';
import { useEffect, useMemo, useState } from 'react';
import { useShell } from './ctx';
import { REGIONS, regionOf } from './regions';
import { ago } from './ui';

interface Row { environment: string; status: string; started_at: string }
type RegionState = 'ok' | 'running' | 'bad';

const RUNNING = /in progress|queued|awaiting/i;
const FAILED = /fail|rolled back/i;
const R = 74; // globe radius in px

// A rotating CSS 3D globe with one pin per AWS region the fleet deploys to.
// Pin colour = the worst latest-deploy status across that region's environments.
export default function FleetGlobe() {
  const { refreshKey } = useShell();
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/deployments?limit=300', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (live) setRows(Array.isArray(d) ? d : d.deployments ?? []); })
      .catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [refreshKey]);

  const regions = useMemo(() => {
    const latestByEnv = new Map<string, Row>();
    for (const r of rows ?? []) {
      const cur = latestByEnv.get(r.environment);
      if (!cur || new Date(r.started_at) > new Date(cur.started_at)) latestByEnv.set(r.environment, r);
    }
    const out = new Map<string, { envs: string[]; state: RegionState; last: string | null }>();
    for (const [env, r] of latestByEnv) {
      const code = regionOf(env);
      const g = out.get(code) ?? { envs: [], state: 'ok' as RegionState, last: null as string | null };
      g.envs.push(env);
      if (FAILED.test(r.status)) g.state = 'bad';
      else if (RUNNING.test(r.status) && g.state !== 'bad') g.state = 'running';
      if (!g.last || r.started_at > g.last) g.last = r.started_at;
      out.set(code, g);
    }
    return [...out.entries()]
      .filter(([code]) => REGIONS[code])
      .map(([code, g]) => ({ ...REGIONS[code], ...g }))
      .sort((a, b) => b.envs.length - a.envs.length);
  }, [rows]);

  if (!rows) return null;

  return (
    <section className="fleet-globe-section tracker-card">
      <div className="card-header">
        <div>
          <h2 className="card-title">Fleet around the world</h2>
          <p className="card-subtitle">Where we deploy, coloured by each region&apos;s latest deploy.</p>
        </div>
      </div>
      <div className="fleet-globe-body">
        <div className="globe-stage" aria-hidden="true">
          <div className="globe" style={{ ['--r' as string]: `${R}px` }}>
            <div className="globe-sphere" />
            <div className="globe-spin">
              {[0, 30, 60, 90, 120, 150].map((d) => (
                <span key={`m${d}`} className="globe-ring" style={{ transform: `rotateY(${d}deg)` }} />
              ))}
              {[-60, -30, 0, 30, 60].map((lat) => {
                const rad = (lat * Math.PI) / 180;
                return (
                  <span key={`p${lat}`} className="globe-ring globe-parallel"
                    style={{ transform: `translateY(${(-R * Math.sin(rad)).toFixed(1)}px) rotateX(90deg) scale(${Math.cos(rad).toFixed(3)})` }} />
                );
              })}
              {regions.map((g) => (
                <span key={g.code} className={`globe-pin is-${g.state}`}
                  style={{ transform: `rotateY(${g.lon}deg) rotateX(${g.lat}deg) translateZ(${R}px)` }} />
              ))}
            </div>
          </div>
        </div>
        <ul className="globe-legend">
          {regions.map((g) => (
            <li key={g.code} title={g.envs.join(', ')}>
              <span className={`globe-dot is-${g.state}`} />
              <span className="globe-city">{g.city}</span>
              <code className="globe-code">{g.code}</code>
              <span className="globe-meta">
                {g.envs.length} env{g.envs.length === 1 ? '' : 's'} · {g.state === 'bad' ? 'last deploy failed' : g.state === 'running' ? 'deploying' : 'healthy'} · {ago(g.last)}
              </span>
            </li>
          ))}
          {regions.length === 0 && <li className="globe-meta">No deployments yet.</li>}
        </ul>
      </div>
    </section>
  );
}
