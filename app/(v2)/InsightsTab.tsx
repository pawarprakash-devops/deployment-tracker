'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import AdminGate from './AdminGate';
import InsightsLists, { type ListsStats } from './InsightsLists';
import { Card, Chip, Empty, ErrorNote, Pill, Skeleton, StatusPill, Tile, type Tone } from './ui';

// ---- types: mirror of GET /api/admin/stats -----------------------------------------------------------
type Tier = 'Elite' | 'High' | 'Medium' | 'Low';
interface DoraBase { value: string; rating: Tier; target: string; status: string }
interface DoraSuite {
  deploymentFrequency: DoraBase & { dailyAverage: number; todayCount: number; weekCount: number };
  leadTimeForChanges: DoraBase & { hours: number };
  changeFailureRate: DoraBase & { rate: number; prodRate: number; failedCount: number; totalCount: number };
  meanTimeToRecovery: DoraBase & { minutes: number; medianMinutes: number; averageMinutes: number; totalRecovered: number };
  overallScore: { tier: Tier; eliteCount: number; highCount: number; summary: string };
}
interface AdminStats extends ListsStats {
  totalDeployments: number;
  successRate: number;
  failureRate: number;
  avgDuration: number;
  deploymentsToday: number;
  deploymentsThisWeek: number;
  byEnvironment: Record<string, number>;
  byStatus: Record<string, number>;
  dora: ListsStats['dora'] & Partial<DoraSuite>;
}

// ---- helpers -----------------------------------------------------------------------------------------
// elite/high ok, medium warn, low bad (the legacy page painted Low green; that is wrong)
const tierTone = (t: string | undefined): Tone => {
  const k = (t ?? '').toLowerCase();
  return k === 'elite' || k === 'high' ? 'ok' : k === 'medium' ? 'warn' : k === 'low' ? 'bad' : 'neutral';
};
const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString('en-GB', { hour12: false });
const fmtDuration = (s: number) => {
  if (!s || s < 1) return '—';
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
  return `${(s / 3600).toFixed(1)}h`;
};
const pct = (n: number) => `${(Number.isFinite(n) ? n : 0).toFixed(1)}%`;
const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

// region + cluster label per environment (ported from the legacy page)
const ENV_CLUSTER: Record<string, [string, string]> = {
  'Preview': ['ap-south-1', 'preview-99999'],
  'QA': ['ap-south-1', 'qa-aps-ecs'],
  'Stage': ['ap-south-1', 'stage-aps-ecs'],
  'Stage EUW2': ['eu-west-2', 'staging-euw2'],
  'Stage USE1': ['us-east-1', 'staging-use1'],
  'Pre-Prod': ['ap-south-1', 'pre-prod-ecs'],
  'Pre-Prod (India)': ['ap-south-1', 'pre-prod-ecs'],
  'Pre-Prod USW': ['us-west-1', 'pre-prod-usw'],
  'Production USW': ['us-west-1', 'production-usw'],
  'Production (Ankura)': ['ap-south-1', 'vidai-prod'],
  'Production (Neotia)': ['ap-south-1', 'prod-aps'],
  'Production (Neotia/Babyjoy)': ['ap-south-1', 'prod-aps'],
  'Production': ['ap-south-1', 'vidai-prod'],
  'LMS': ['ap-south-1', 'lms-aps-ecs'],
};
function clusterChip(env: string): string | null {
  const hit = ENV_CLUSTER[env];
  if (hit) return `${hit[0]} · ${hit[1]}`;
  const l = env.toLowerCase();
  const region = /euw2|eu-west-2|london/.test(l) ? 'eu-west-2'
    : /usw2|us-west-2|oregon/.test(l) ? 'us-west-2'
    : /usw|us-west-1|california/.test(l) ? 'us-west-1'
    : /use1|us-east-1|virginia/.test(l) ? 'us-east-1'
    : /euc1|eu-central-1|frankfurt/.test(l) ? 'eu-central-1' : 'ap-south-1';
  return `${region} · ${l.replace(/\s+/g, '-')}`;
}

function statusTone(status: string): Tone {
  const s = status.toLowerCase();
  return /success/.test(s) ? 'ok' : /fail/.test(s) ? 'bad' : /progress|pending|awaiting/.test(s) ? 'info' : /roll|cancel|queued|reject/.test(s) ? 'warn' : 'neutral';
}

function Meter({ value, tone, label }: { value: number; tone: Tone; label: string }) {
  const w = `${Math.round(clamp01(value) * 100)}%`;
  return (
    <div className="bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamp01(value) * 100)}>
      <span style={{ width: w, background: `var(--${tone})`, boxShadow: 'none' }} />
    </div>
  );
}

function DoraCard({ title, value, tier, target, bar, barLabel, children }: {
  title: string; value: string; tier: string; target: string; bar: number; barLabel: string; children?: React.ReactNode;
}) {
  const tone = tierTone(tier);
  return (
    <div className="card" style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
      <div className="card-h" style={{ marginBottom: 0 }}>
        <h2>{title}</h2>
        <Pill tone={tone}>{tier}</Pill>
      </div>
      <div className="tnum" style={{ fontSize: 'var(--fs-xl)', lineHeight: 'var(--lh-xl)', fontWeight: 700 }}>{value}</div>
      <Meter value={bar} tone={tone} label={`${title} against elite target`} />
      <div className="subtle">{barLabel} · Target {target}</div>
      {children && <div className="subtle" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>{children}</div>}
    </div>
  );
}

function Distribution({ entries, total, tone, cluster }: {
  entries: [string, number][]; total: number; tone: (k: string) => Tone; cluster?: boolean;
}) {
  if (entries.length === 0) return <Empty>No deployments recorded yet.</Empty>;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {entries.map(([name, count]) => {
        const share = total > 0 ? (count / total) * 100 : 0;
        const t = tone(name);
        const cc = cluster ? clusterChip(name) : null;
        return (
          <div key={name}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
                {cluster ? <strong style={{ fontSize: 'var(--fs-sm)' }}>{name}</strong> : <StatusPill status={name} />}
                {cc && <Chip title="Region and cluster">{cc}</Chip>}
              </span>
              <span className="tnum" style={{ fontSize: 'var(--fs-sm)' }}>
                <strong>{count}</strong> <span className="muted">({pct(share)})</span>
              </span>
            </div>
            <Meter value={share / 100} tone={t} label={`${name}: ${pct(share)} of deployments`} />
          </div>
        );
      })}
    </div>
  );
}

// ---- tab ---------------------------------------------------------------------------------------------
export default function InsightsTab() {
  return (
    <AdminGate title="Insights">
      <InsightsBody />
    </AdminGate>
  );
}

function InsightsBody() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/stats', { cache: 'no-store', credentials: 'same-origin' });
      if (!alive.current) return;
      if (res.status === 401) {
        setExpired(true);
        setStats(null);
        window.dispatchEvent(new CustomEvent('tracker:auth-changed'));
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as AdminStats;
      if (!alive.current) return;
      setStats(j);
      setError(null);
      setExpired(false);
      setUpdatedAt(Date.now());
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      if (alive.current) setBusy(false);
    }
  }, []);

  const refresh = () => { setBusy(true); void load(); };

  useEffect(() => {
    alive.current = true;
    const t0 = setTimeout(() => void load(), 0);
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 90_000);
    const on = () => void load();
    window.addEventListener('tracker:data-changed', on);
    window.addEventListener('tracker:refresh', on);
    return () => {
      alive.current = false;
      clearTimeout(t0);
      clearInterval(t);
      window.removeEventListener('tracker:data-changed', on);
      window.removeEventListener('tracker:refresh', on);
    };
  }, [load]);

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'space-between' }}>
      <div className="page-h" style={{ margin: 0 }}>
        <h1>Insights</h1>
        <p>Deployment health and DORA delivery metrics across all environments.</p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {updatedAt && <span className="subtle tnum" aria-live="polite">updated {fmtTime(updatedAt)}</span>}
        <button type="button" className="btn" onClick={refresh} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh'}</button>
      </div>
    </div>
  );

  if (expired) {
    return (
      <div className="stack" style={{ marginTop: 0 }}>
        {header}
        <ErrorNote>Session expired, sign in again.</ErrorNote>
      </div>
    );
  }
  if (!stats) {
    return (
      <div className="stack" style={{ marginTop: 0 }}>
        {header}
        {error ? <ErrorNote>Could not load insights ({error}). Use Refresh to retry.</ErrorNote> : <Skeleton rows={5} />}
      </div>
    );
  }

  const total = stats.totalDeployments;
  const d = stats.dora as AdminStats['dora'] | undefined;
  const envs = Object.entries(stats.byEnvironment ?? {}).sort(([, a], [, b]) => b - a);
  const statuses = Object.entries(stats.byStatus ?? {}).sort(([, a], [, b]) => b - a);
  const noIncidents = !d?.meanTimeToRecovery || d.meanTimeToRecovery.totalRecovered === 0;

  return (
    <div className="stack" style={{ marginTop: 0 }}>
      {header}
      {error && <ErrorNote>Showing the last good data. Refresh failed ({error}).</ErrorNote>}

      <div className="stat-row" role="group" aria-label="Headline deployment numbers">
        <Tile label="Total deployments" value={total} hint="All time" />
        <Tile label="Success rate" value={pct(stats.successRate)} tone={stats.successRate >= 90 ? 'ok' : stats.successRate >= 75 ? 'warn' : 'bad'} hint={stats.successRate >= 90 ? 'Healthy' : stats.successRate >= 75 ? 'Needs attention' : 'Poor'} />
        <Tile label="Failure rate" value={pct(stats.failureRate)} tone={stats.failureRate <= 5 ? 'ok' : stats.failureRate <= 15 ? 'warn' : 'bad'} hint={stats.failureRate <= 5 ? 'Low' : stats.failureRate <= 15 ? 'Elevated' : 'High'} />
        <Tile label="Avg runtime" value={fmtDuration(stats.avgDuration)} hint="Per deployment" />
        <Tile label="Today" value={stats.deploymentsToday} hint="Since midnight" />
        <Tile label="Last 7 days" value={stats.deploymentsThisWeek} hint="Rolling week" />
      </div>

      <Card
        title="DORA metrics"
        action={d?.overallScore ? <Pill tone={tierTone(d.overallScore.tier)}>{d.overallScore.tier} performer</Pill> : undefined}
      >
        {!d?.deploymentFrequency || !d.leadTimeForChanges || !d.changeFailureRate || !d.meanTimeToRecovery || !d.overallScore ? (
          <Empty>DORA metrics are not available yet.</Empty>
        ) : (
          <>
            <p className="muted" style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--fs-sm)' }}>
              {d.overallScore.summary} <span className="subtle">({d.overallScore.eliteCount} elite, {d.overallScore.highCount} high of 4 metrics)</span>
            </p>
            <div className="grid g4">
              <DoraCard
                title="Deployment frequency"
                value={d.deploymentFrequency.value}
                tier={d.deploymentFrequency.rating}
                target={d.deploymentFrequency.target}
                bar={d.deploymentFrequency.dailyAverage / 3}
                barLabel="Share of elite pace (3 per day)"
              >
                <span>Today <strong className="tnum">{d.deploymentFrequency.todayCount}</strong></span>
                <span>7 days <strong className="tnum">{d.deploymentFrequency.weekCount}</strong></span>
              </DoraCard>
              <DoraCard
                title="Lead time"
                value={d.leadTimeForChanges.value}
                tier={d.leadTimeForChanges.rating}
                target={d.leadTimeForChanges.target}
                bar={d.leadTimeForChanges.hours > 0 ? 24 / d.leadTimeForChanges.hours : 1}
                barLabel="Closeness to elite (24h)"
              />
              <DoraCard
                title="Change failure rate"
                value={d.changeFailureRate.value}
                tier={d.changeFailureRate.rating}
                target={d.changeFailureRate.target}
                bar={d.changeFailureRate.rate > 0 ? 5 / d.changeFailureRate.rate : 1}
                barLabel="Closeness to elite (5%)"
              >
                <span>Prod only <strong className="tnum">{d.changeFailureRate.prodRate}%</strong></span>
                <span>Failed <strong className="tnum">{d.changeFailureRate.failedCount}</strong> of <strong className="tnum">{d.changeFailureRate.totalCount}</strong></span>
              </DoraCard>
              <DoraCard
                title="Time to recovery"
                value={noIncidents ? 'No incidents' : d.meanTimeToRecovery.value}
                tier={d.meanTimeToRecovery.rating}
                target={d.meanTimeToRecovery.target}
                bar={noIncidents || d.meanTimeToRecovery.minutes <= 0 ? 1 : 30 / d.meanTimeToRecovery.minutes}
                barLabel="Closeness to elite (30m)"
              >
                <span>Median <strong className="tnum">{d.meanTimeToRecovery.medianMinutes}m</strong></span>
                <span>Recovered <strong className="tnum">{d.meanTimeToRecovery.totalRecovered}</strong> runs</span>
              </DoraCard>
            </div>
          </>
        )}
      </Card>

      <div className="grid g2">
        <Card title="By environment" action={<span className="subtle tnum">{envs.length} targets</span>}>
          <Distribution entries={envs} total={total} tone={() => 'info'} cluster />
        </Card>
        <Card title="By status" action={<span className="subtle tnum">{statuses.length} states</span>}>
          <Distribution entries={statuses} total={total} tone={statusTone} />
        </Card>
      </div>

      <InsightsLists stats={stats} />
    </div>
  );
}
