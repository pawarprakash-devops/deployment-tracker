'use client';
import { useEffect, useMemo, useState } from 'react';
import { Card, Empty, ErrorNote, Skeleton, Spark, Tile } from './ui';

interface Row { environment: string; status: string; at: number }
const DAY = 86_400_000;
const WINDOW = 30;
const isSuccess = (s: string) => /(^|\s)success$/i.test(s.trim());
const isBad = (s: string) => /fail|roll/i.test(s);
const isProd = (e: string) => /^production/i.test(e.trim());

function parse(j: unknown): Row[] {
  const list: unknown[] = Array.isArray(j) ? j : Array.isArray((j as { deployments?: unknown })?.deployments) ? (j as { deployments: unknown[] }).deployments
    : Array.isArray((j as { data?: unknown })?.data) ? (j as { data: unknown[] }).data : Array.isArray((j as { rows?: unknown })?.rows) ? (j as { rows: unknown[] }).rows : [];
  const out: Row[] = [];
  for (const x of list as Record<string, unknown>[]) {
    const t = new Date(String(x?.started_at ?? x?.created_at ?? '')).getTime();
    if (!Number.isFinite(t) || typeof x.environment !== 'string') continue;
    out.push({ environment: x.environment, status: String(x.status ?? ''), at: t });
  }
  return out;
}

function median(a: number[]) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export default function MgmtLens() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/deployments?limit=1000');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const parsed = parse(await r.json());
        if (alive) setRows(parsed);
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : 'Failed to load');
      }
    })();
    return () => { alive = false; };
  }, []);

  const m = useMemo(() => {
    if (!rows) return null;
    // eslint-disable-next-line react-hooks/purity -- wall-clock window for a client-only, fetched-on-mount view
    const now = Date.now();
    const recent = rows.filter((r) => r.at >= now - WINDOW * DAY && r.at <= now + DAY).sort((a, b) => a.at - b.at);
    const prod = recent.filter((r) => isProd(r.environment));
    const series = (list: Row[]) => {
      const s = Array<number>(14).fill(0);
      for (const r of list) {
        const i = 13 - Math.floor((now - r.at) / DAY);
        if (i >= 0 && i < 14) s[i]++;
      }
      return s;
    };
    const prodFail = prod.filter((r) => isBad(r.status)).length;
    // MTTR: failed row -> next success in the same production environment
    const mttr: number[] = [];
    const open = new Map<string, number>();
    for (const r of prod) {
      if (isBad(r.status)) { if (!open.has(r.environment)) open.set(r.environment, r.at); }
      else if (isSuccess(r.status) && open.has(r.environment)) {
        mttr.push((r.at - open.get(r.environment)!) / 60_000);
        open.delete(r.environment);
      }
    }
    const byEnv = new Map<string, number>();
    for (const r of recent) byEnv.set(r.environment, (byEnv.get(r.environment) ?? 0) + 1);
    return {
      total: recent.length, prodTotal: prod.length, prodFail,
      cfr: prod.length ? (prodFail / prod.length) * 100 : null,
      mttr: median(mttr), mttrN: mttr.length,
      allSeries: series(recent), prodSeries: series(prod),
      envs: [...byEnv.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [rows]);

  const heading = <div className="page-h"><h1>Delivery overview</h1><p>Last 30 days</p></div>;
  if (err) return <>{heading}<ErrorNote>Could not load deployments: {err}</ErrorNote></>;
  if (!m) return <>{heading}<Card><Skeleton rows={5} /></Card></>;
  if (m.total === 0) return <>{heading}<Card><Empty>No deployments recorded in the last 30 days.</Empty></Card></>;

  const perDay = (n: number) => (n / WINDOW).toFixed(1);
  const fmtMin = (v: number | null) => v == null ? '—' : v >= 120 ? `${(v / 60).toFixed(1)} h` : `${Math.round(v)} min`;
  const maxEnv = Math.max(...m.envs.map(([, n]) => n), 1);

  return (
    <>
      {heading}
      <div className="grid g4">
        <Tile label="Production deploys / day" value={perDay(m.prodTotal)} hint={`${m.prodTotal} in 30 days`}>
          <Spark points={m.prodSeries} label={`Production deployments per day, last 14 days: ${m.prodSeries.join(', ')}`} />
        </Tile>
        <Tile label="All deploys / day" value={perDay(m.total)} hint={`${m.total} in 30 days`}>
          <Spark points={m.allSeries} label={`All deployments per day, last 14 days: ${m.allSeries.join(', ')}`} />
        </Tile>
        <Tile label="Change failure rate" value={m.cfr == null ? '—' : `${m.cfr.toFixed(1)}%`}
          tone={m.cfr == null ? undefined : m.cfr > 15 ? 'bad' : m.cfr > 5 ? 'warn' : 'ok'}
          hint={m.cfr == null ? 'No production deploys' : `${m.prodFail} failed or rolled back of ${m.prodTotal} (production)`} />
        <Tile label="MTTR (median)" value={fmtMin(m.mttr)}
          hint={m.mttrN ? `Production, failure to next success, ${m.mttrN} incident${m.mttrN > 1 ? 's' : ''}` : 'No recovered production failures'} />
        <Tile label="Lead time" value="—" hint="Needs Jira (admin sign-in)" />
        <Tile label="Sprint progress" value="—" hint="Needs Jira (admin sign-in)" />
      </div>
      <div className="stack">
        <Card title="Deployments by environment (30 d)">
          <table>
            <thead><tr><th scope="col">Environment</th><th scope="col">Deploys</th><th scope="col"><span className="muted">Share</span></th></tr></thead>
            <tbody>
              {m.envs.map(([env, n]) => (
                <tr key={env}>
                  <td>{env}</td>
                  <td className="tnum">{n}</td>
                  <td style={{ width: '50%' }}><div className="bar" aria-hidden="true"><span style={{ width: `${(n / maxEnv) * 100}%` }} /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
