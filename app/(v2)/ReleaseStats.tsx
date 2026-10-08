'use client';
import { useEffect, useMemo, useState } from 'react';
import { Card, Empty, ErrorNote, Skeleton, Tile } from './ui';

interface Dep { environment: string; status: string; deployed_by?: string | null; notes?: string | null; started_at: string }
interface Day { date: string; label: string; short: string; success: number; failed: number; other: number; total: number }

const isSuccess = (s: string) => /(^|\s)success$/i.test(s);
const isFailed = (s: string) => /fail/i.test(s);
const isRollback = (s: string) => /roll/i.test(s);

const SR_ONLY: React.CSSProperties = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0, padding: 0, margin: -1 };

// Distinct fill patterns so status is never conveyed by colour alone.
const FILL = {
  success: { background: 'var(--ok)' },
  failed: { background: 'repeating-linear-gradient(45deg, var(--bad) 0 4px, var(--bad-bg) 4px 8px)' },
  other: { background: 'radial-gradient(circle, var(--neutral, #8b8f98) 1.5px, transparent 1.6px) 0 0 / 6px 6px, var(--border)' },
} as const;

export default function ReleaseStats() {
  const [deps, setDeps] = useState<Dep[] | null>(null);
  const [envs, setEnvs] = useState<{ name: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [d, e] = await Promise.all([
          fetch('/api/deployments?limit=1000', { cache: 'no-store' }),
          fetch('/api/environments', { cache: 'no-store' }),
        ]);
        if (!d.ok || !e.ok) throw new Error(`HTTP ${!d.ok ? d.status : e.status}`);
        const [dj, ej] = await Promise.all([d.json(), e.json()]);
        if (!alive) return;
        setDeps(Array.isArray(dj) ? dj : []);
        setEnvs(Array.isArray(ej) ? ej : []);
        setNow(Date.now());
        setError(null);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Failed to load');
      }
    };
    load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 90_000);
    const onEvt = () => { load(); };
    window.addEventListener('tracker:data-changed', onEvt);
    window.addEventListener('tracker:refresh', onEvt);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener('tracker:data-changed', onEvt);
      window.removeEventListener('tracker:refresh', onEvt);
    };
  }, []);

  const stats = useMemo(() => {
    if (!deps || !envs || now == null) return null;
    const rows = deps.filter((d) => !(d.deployed_by ?? '').includes('Deployment Tracker'));
    const total = rows.length;
    const ok = rows.filter((d) => isSuccess(d.status)).length;
    const rollbacks = rows.filter((d) => isRollback(d.status) || /rollback/i.test(d.notes ?? '')).length;
    const today = new Date(now).toISOString().slice(0, 10);
    const todayCount = rows.filter((d) => d.started_at?.slice(0, 10) === today).length;
    // latest deploy per environment (rows ordered by time, newest wins)
    const latest = new Map<string, Dep>();
    for (const d of rows) {
      const cur = latest.get(d.environment);
      if (!cur || d.started_at > cur.started_at) latest.set(d.environment, d);
    }
    const failedLatest = envs.filter((e) => { const l = latest.get(e.name); return l && isFailed(l.status); }).length;
    const days: Day[] = [];
    for (let i = 13; i >= 0; i--) {
      const dt = new Date(now - i * 86_400_000);
      const date = dt.toISOString().slice(0, 10);
      const day = rows.filter((d) => d.started_at?.startsWith(date));
      const success = day.filter((d) => isSuccess(d.status)).length;
      const failed = day.filter((d) => isFailed(d.status)).length;
      days.push({
        date, success, failed, other: day.length - success - failed, total: day.length,
        label: dt.toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
        short: String(dt.getUTCDate()),
      });
    }
    return { total, rate: total ? ((ok / total) * 100).toFixed(1) : null, rollbacks, todayCount, failedLatest, envCount: envs.length, days, max: Math.max(1, ...days.map((d) => d.total)) };
  }, [deps, envs, now]);

  if (error && !stats) return <ErrorNote>Could not load release stats: {error}</ErrorNote>;
  if (!stats) return <Card title="Release stats"><Skeleton rows={4} /></Card>;

  const headline = `${stats.envCount} environment${stats.envCount === 1 ? '' : 's'}, ${stats.failedLatest} with a failed latest deploy`;
  const rateTone = stats.rate == null ? undefined : Number(stats.rate) >= 90 ? 'ok' : Number(stats.rate) >= 70 ? 'warn' : 'bad';
  const anyDays = stats.days.some((d) => d.total > 0);

  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      {error && <ErrorNote>Showing last loaded data; refresh failed: {error}</ErrorNote>}
      <section aria-label="Release telemetry">
        <p style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--fs-sm)', color: stats.failedLatest ? 'var(--bad-text)' : 'var(--ok-text)' }}>
          <span aria-hidden="true">{stats.failedLatest ? '✕ ' : '✓ '}</span>{headline}
        </p>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          <Tile label="Success rate" value={stats.rate == null ? '—' : `${stats.rate}%`} tone={rateTone} hint="Of all tracked runs" />
          <Tile label="Total runs" value={stats.total} />
          <Tile label="Today's deploys" value={stats.todayCount} hint="UTC day" />
          <Tile label="Tracked targets" value={stats.envCount} hint="Environments" />
          <Tile label="Rollback events" value={stats.rollbacks} tone={stats.rollbacks ? 'warn' : 'ok'} />
        </div>
      </section>

      <Card title="14-day deployment timeline">
        {!anyDays ? <Empty>No deployments in the last 14 days.</Empty> : (
          <>
            <div role="group" aria-label="Deployments per day, last 14 days" style={{ display: 'flex', gap: 'clamp(2px, 1vw, 8px)', alignItems: 'flex-end', height: 150, minWidth: 0 }}>
              {stats.days.map((d) => (
                <div key={d.date} title={`${d.label}: ${d.success} success, ${d.failed} failed, ${d.other} other`}
                  style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'stretch', height: '100%' }}>
                  <span className="tnum" aria-hidden="true" style={{ textAlign: 'center', fontSize: 'var(--fs-xs)', color: 'var(--muted)', lineHeight: 1.4 }}>{d.total || ''}</span>
                  <div aria-hidden="true" style={{ height: `${(d.total / stats.max) * 100}%`, display: 'flex', flexDirection: 'column-reverse', borderRadius: 3, overflow: 'hidden', minHeight: d.total ? 3 : 0 }}>
                    {(['success', 'failed', 'other'] as const).map((k) => d[k] > 0 && <div key={k} style={{ flex: d[k], ...FILL[k] }} />)}
                  </div>
                  <span aria-hidden="true" style={{ textAlign: 'center', fontSize: 'var(--fs-xs)', color: 'var(--muted)', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden' }}>{d.short}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', marginTop: 'var(--space-3)', fontSize: 'var(--fs-xs)', color: 'var(--muted)' }}>
              {([['success', 'Success (solid)'], ['failed', 'Failed (striped)'], ['other', 'Other (dotted)']] as const).map(([k, t]) => (
                <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span aria-hidden="true" style={{ width: 14, height: 14, borderRadius: 3, border: '1px solid var(--border)', ...FILL[k] }} />{t}
                </span>
              ))}
              <span>Day of month, UTC. Hover a bar for counts.</span>
            </div>
            <table style={SR_ONLY}>
              <caption>Deployments per day, last 14 days</caption>
              <thead><tr><th scope="col">Day</th><th scope="col">Success</th><th scope="col">Failed</th><th scope="col">Other</th><th scope="col">Total</th></tr></thead>
              <tbody>{stats.days.map((d) => <tr key={d.date}><th scope="row">{d.label}</th><td>{d.success}</td><td>{d.failed}</td><td>{d.other}</td><td>{d.total}</td></tr>)}</tbody>
            </table>
          </>
        )}
      </Card>
    </div>
  );
}
