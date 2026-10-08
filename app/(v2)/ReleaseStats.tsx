'use client';
import { useEffect, useMemo, useState } from 'react';
import { Card, Empty, ErrorNote } from './ui';

interface Summary { total: number; success: number; failed: number; rollbacks: number; today: number; days: { date: string; success: number; failed: number; other: number; total: number }[]; latest: { environment: string; status: string }[] }
interface Day { date: string; label: string; short: string; success: number; failed: number; other: number; total: number }

const isFailed = (s: string) => /fail/i.test(s);

const SR_ONLY: React.CSSProperties = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0, padding: 0, margin: -1 };
const CHART_H = 84;
const LABEL_H = 14; // room above the tallest bar for its count
const BAR_MAX_W = 56;
const GAP = 3;

// Distinct fill patterns so status is never conveyed by colour alone.
const FILL = {
  success: { background: 'var(--ok)' },
  failed: { background: 'repeating-linear-gradient(45deg, var(--bad) 0 3px, var(--bad-bg) 3px 6px)' },
  other: { background: 'radial-gradient(circle, var(--neutral, #8b8f98) 1.2px, transparent 1.3px) 0 0 / 5px 5px, var(--border)' },
} as const;

const TONE_COLOR = { ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)' } as const;
const TONE_TEXT = { ok: 'var(--ok-text)', warn: 'var(--warn-text)', bad: 'var(--bad-text)' } as const;
const SMALL: React.CSSProperties = { fontSize: 12.5, lineHeight: '16px', color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

function Ring({ pct, tone }: { pct: number; tone: keyof typeof TONE_COLOR }) {
  const r = 11, c = 2 * Math.PI * r;
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true" style={{ flex: 'none' }}>
      <circle cx="14" cy="14" r={r} fill="none" stroke="var(--border-bright)" strokeWidth="3" />
      <circle cx="14" cy="14" r={r} fill="none" stroke={TONE_COLOR[tone]} strokeWidth="3" strokeLinecap="round"
        strokeDasharray={`${(Math.min(100, Math.max(0, pct)) / 100) * c} ${c}`} transform="rotate(-90 14 14)" />
    </svg>
  );
}

function Stat({ label, value, hint, first, tone, ring }: { label: string; value: string | number; hint?: string; first?: boolean; tone?: keyof typeof TONE_TEXT; ring?: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0, paddingLeft: first ? 0 : 12, borderLeft: first ? 'none' : '1px solid var(--border)' }}>
      <div style={SMALL}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 28 }}>
        {ring}
        <span className="tnum" style={{ fontSize: 21, lineHeight: '28px', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: tone ? TONE_TEXT[tone] : 'var(--text)' }}>{value}</span>
      </div>
      <div style={SMALL}>{hint ?? ' '}</div>
    </div>
  );
}

export default function ReleaseStats() {
  const [sum, setSum] = useState<Summary | null>(null);
  const [envs, setEnvs] = useState<{ name: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        // whole-table counts come from SQL (/api/summary); /api/deployments is capped at 1000 rows
        const [d, e] = await Promise.all([
          fetch('/api/summary', { cache: 'no-store' }),
          fetch('/api/environments', { cache: 'no-store' }),
        ]);
        if (!d.ok || !e.ok) throw new Error(`HTTP ${!d.ok ? d.status : e.status}`);
        const [dj, ej] = await Promise.all([d.json(), e.json()]);
        if (!alive) return;
        setSum(dj as Summary);
        setEnvs(Array.isArray(ej) ? ej : []);
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
    if (!sum || !envs) return null;
    const latest = new Map(sum.latest.map((l) => [l.environment, l.status]));
    const failedLatest = envs.filter((e) => { const l = latest.get(e.name); return l && isFailed(l); }).length;
    const days: Day[] = sum.days.map((d) => {
      const dt = new Date(`${d.date}T00:00:00Z`);
      return {
        ...d,
        label: dt.toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
        short: String(dt.getUTCDate()),
      };
    });
    return {
      total: sum.total,
      rate: sum.total ? ((sum.success / sum.total) * 100).toFixed(1) : null,
      rollbacks: sum.rollbacks, todayCount: sum.today, failedLatest, envCount: envs.length, days,
      max: Math.max(1, ...days.map((d) => d.total)),
    };
  }, [sum, envs]);

  if (error && !stats) return <ErrorNote>Could not load release stats: {error}</ErrorNote>;
  if (!stats) return <Card title="Delivery pulse"><div className="skeleton" aria-busy="true" aria-label="Loading" style={{ height: 112 }} /></Card>;

  const headline = `${stats.envCount} environment${stats.envCount === 1 ? '' : 's'}, ${stats.failedLatest} with a failed latest deploy`;
  const rateNum = stats.rate == null ? null : Number(stats.rate);
  const rateTone = rateNum == null ? 'ok' : rateNum >= 90 ? 'ok' : rateNum >= 70 ? 'warn' : 'bad';
  const anyDays = stats.days.some((d) => d.total > 0);
  const barArea = CHART_H - LABEL_H;
  const chartW = 14 * BAR_MAX_W + 13 * GAP;

  return (
    <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
      {error && <ErrorNote>Showing last loaded data; refresh failed: {error}</ErrorNote>}
      <Card title="Delivery pulse">
        <div aria-label="Release telemetry" role="group" style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 28px', alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 540px', minWidth: 0 }}>
            <p style={{ margin: '0 0 6px', fontSize: 13, lineHeight: '18px', color: stats.failedLatest ? 'var(--bad-text)' : 'var(--ok-text)' }}>
              <span aria-hidden="true">{stats.failedLatest ? '✕ ' : '✓ '}</span>{headline}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(104px, 1fr))', rowGap: 10, columnGap: 8 }}>
              <Stat first label="Success rate" value={rateNum == null ? '—' : `${stats.rate}%`} hint="Of all tracked runs"
                tone={rateNum == null ? undefined : rateTone} ring={rateNum == null ? undefined : <Ring pct={rateNum} tone={rateTone} />} />
              <Stat label="Total runs" value={stats.total} hint="All time" />
              <Stat label="Today's deploys" value={stats.todayCount} hint="UTC day" />
              <Stat label="Tracked targets" value={stats.envCount} hint="Environments" />
              <Stat label="Rollback events" value={stats.rollbacks} hint={stats.rollbacks ? 'Needs a look' : 'None'} tone={stats.rollbacks ? 'warn' : undefined} />
            </div>
          </div>

          <div style={{ flex: '1 1 380px', minWidth: 0 }}>
            {!anyDays ? <Empty>No deployments in the last 14 days.</Empty> : (
              <>
                <div style={{ position: 'relative', maxWidth: chartW }}>
                  <span aria-hidden="true" className="tnum" style={{ position: 'absolute', left: 0, top: 0, fontSize: 11.5, lineHeight: '14px', color: 'var(--muted)' }}>max {stats.max}</span>
                  <div role="group" aria-label="Deployments per day, last 14 days"
                    style={{ display: 'flex', gap: GAP, alignItems: 'flex-end', height: CHART_H, borderBottom: '1px solid var(--border-bright)' }}>
                    {stats.days.map((d, i) => {
                      const h = d.total ? Math.max(3, Math.round((d.total / stats.max) * barArea)) : 0;
                      const showCount = d.total > 0 && (d.total === stats.max || i === stats.days.length - 1);
                      return (
                        <div key={d.date} title={`${d.label}: ${d.success} success, ${d.failed} failed, ${d.other} other`}
                          style={{ flex: 1, maxWidth: BAR_MAX_W, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'stretch' }}>
                          {showCount && <span className="tnum" aria-hidden="true" style={{ textAlign: 'center', fontSize: 11.5, lineHeight: `${LABEL_H}px`, color: 'var(--text)', fontWeight: 600 }}>{d.total}</span>}
                          <div aria-hidden="true" style={{ height: h, display: 'flex', flexDirection: 'column-reverse', borderRadius: '4px 4px 0 0', overflow: 'hidden' }}>
                            {(['success', 'failed', 'other'] as const).map((k) => d[k] > 0 && <div key={k} style={{ flex: d[k], ...FILL[k] }} />)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div aria-hidden="true" style={{ display: 'flex', gap: GAP, marginTop: 3 }}>
                    {stats.days.map((d) => (
                      <span key={d.date} className="tnum" style={{ flex: 1, maxWidth: BAR_MAX_W, minWidth: 0, textAlign: 'center', fontSize: 12.5, lineHeight: '15px', color: 'var(--text)', overflow: 'visible', whiteSpace: 'nowrap' }}><b style={{ fontWeight: 600 }}>{d.short}</b><br /><span style={{ color: 'var(--muted)', fontSize: 12 }}>{d.label.split(' ')[0]}</span></span>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', marginTop: 4, fontSize: 12, lineHeight: '16px', color: 'var(--muted)' }}>
                  {([['success', 'Success'], ['failed', 'Failed'], ['other', 'Other']] as const).map(([k, t]) => (
                    <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 2, border: '1px solid var(--border)', ...FILL[k] }} />{t}
                    </span>
                  ))}
                  <span>Last 14 days, UTC</span>
                </div>
                <table style={SR_ONLY}>
                  <caption>Deployments per day, last 14 days</caption>
                  <thead><tr><th scope="col">Day</th><th scope="col">Success</th><th scope="col">Failed</th><th scope="col">Other</th><th scope="col">Total</th></tr></thead>
                  <tbody>{stats.days.map((d) => <tr key={d.date}><th scope="row">{d.label}</th><td>{d.success}</td><td>{d.failed}</td><td>{d.other}</td><td>{d.total}</td></tr>)}</tbody>
                </table>
              </>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
