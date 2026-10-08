'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { QualityResponse, ReopenRow, SlowBug } from '@/lib/tickets-types';
import { Card, Empty, ErrorNote, Pill, Skeleton, fmtDate, fmtDateTime } from '../ui';
import type { Tone } from '../ui';
import { RateBadge, ReopenTrendChart, TtrByPriority, TtrDistribution, TtrTrendChart, formatHours } from './QualityCharts';

const WINDOWS = [14, 30, 60, 90];
const POLL_MS = 5 * 60_000;
const STEP = 8;
const ctl: CSSProperties = { height: 34, minHeight: 34, border: '1px solid var(--border-bright)', background: 'var(--panel)', color: 'var(--text)', borderRadius: 'var(--r-sm)', padding: '0 10px', fontSize: 'var(--fs-sm)', fontFamily: 'inherit', textTransform: 'none', letterSpacing: 0, fontWeight: 400 };
const SR_ONLY: CSSProperties = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap' };

const CSS = `
.qp-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));row-gap:14px}
.qp-stat{padding:0 14px;border-left:1px solid var(--border);min-width:0}
.qp-stat:first-child{border-left:0;padding-left:0}
.qp-sl{font-size:var(--fs-xs);color:var(--muted);text-transform:uppercase;letter-spacing:.06em;font-weight:600}
.qp-sv{font-size:24px;line-height:1.2;font-weight:600;margin-top:2px;font-variant-numeric:tabular-nums}
.qp-sx{font-size:var(--fs-xs);margin-top:2px;min-height:18px}
.qp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr));gap:var(--space-4,16px);margin-top:16px}
.qp-lists{display:grid;grid-template-columns:1fr;gap:var(--space-4,16px);margin-top:16px}
.qp-list{list-style:none;margin:0;padding:0}
.qp-row{padding:9px 2px;border-top:1px solid var(--border)}
.qp-row:first-child{border-top:0}
.qp-l1{display:flex;align-items:baseline;gap:8px;min-width:0}
.qp-sum{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qp-l2{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;margin-top:4px;font-size:13px;color:var(--muted)}
.qp-key{text-decoration:none}.qp-key:hover{text-decoration:underline}
.qp-key:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px;border-radius:var(--r-xs)}
@media (min-width:1100px){.qp-wide{grid-column:span 2}.qp-lists{grid-template-columns:1fr 1fr}}
@media (max-width:640px){.qp-sum{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}.qp-l1{flex-wrap:wrap}}
`;

// Percent change with words. `goodWhen` down = a lower number is better (time).
const PREV_INCOMPLETE = <span className="muted">previous period incomplete</span>;

function Delta({ now, before, incomplete }: { now: number | null; before: number | null | undefined; incomplete?: boolean }) {
  if (incomplete) return PREV_INCOMPLETE;
  if (now == null || before == null || before === 0) return <span className="muted">no previous data</span>;
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return <span className="muted">— no change vs previous</span>;
    const better = pct < 0;
  return (
    <span style={{ color: better ? 'var(--ok-text)' : 'var(--warn-text)', fontWeight: 600 }}>
      <span aria-hidden="true">{better ? '▼' : '▲'} </span>{Math.abs(pct)}% {better ? 'faster' : 'slower'}
      <span className="muted" style={{ fontWeight: 400 }}> vs previous</span>
    </span>
  );
}

function CountDelta({ now, before, incomplete }: { now: number; before: number | null | undefined; incomplete?: boolean }) {
  if (incomplete) return PREV_INCOMPLETE;
  if (before == null) return <span className="muted">no previous data</span>;
  const d = now - before;
  if (d === 0) return <span className="muted">— same as previous ({before})</span>;
  return <span className="muted"><span aria-hidden="true">{d > 0 ? '▲' : '▼'} </span>{Math.abs(d)} {d > 0 ? 'more' : 'fewer'} than previous ({before})</span>;
}

function Stat({ label, value, extra }: { label: string; value: ReactNode; extra?: ReactNode }) {
  return (
    <div className="qp-stat">
      <div className="qp-sl">{label}</div>
      <div className="qp-sv">{value}</div>
      <div className="qp-sx">{extra}</div>
    </div>
  );
}

function PriorityTag({ p }: { p: string | null }) {
  const tone: Tone = /highest|blocker|critical|p0/i.test(p || '') ? 'bad' : /high|major|p1/i.test(p || '') ? 'warn' : 'neutral';
  return <Pill tone={tone} icon={false}>{p || 'No priority'}</Pill>;
}

function IssueLink({ k, url }: { k: string; url: string }) {
  return <a className="key qp-key" href={url} target="_blank" rel="noopener noreferrer" style={{ flex: 'none' }}>{k}<span style={SR_ONLY}> (opens in a new tab)</span></a>;
}

function MoreRow({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  if (total <= STEP) return null;
  const next = Math.min(STEP, total - shown);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
      {next > 0 && <button type="button" className="btn" onClick={onMore}>Show more ({next})</button>}
      <span className="muted" style={{ fontSize: 13 }} aria-live="polite">Showing {shown} of {total}</span>
    </div>
  );
}

function SlowList({ items }: { items: SlowBug[] }) {
  const [n, setN] = useState(STEP);
  const rows = items.slice(0, 10);
  if (rows.length === 0) return <Empty>No bugs were resolved in this window.</Empty>;
  const vis = rows.slice(0, n);
  return (
    <>
      <ol className="qp-list" aria-label="Slowest bugs to resolve">
        {vis.map((b) => (
          <li key={b.key} className="qp-row">
            <div className="qp-l1">
              <IssueLink k={b.key} url={b.url} />
              <span className="qp-sum" title={b.summary}>{b.summary}</span>
            </div>
            <div className="qp-l2">
              <PriorityTag p={b.priority} />
              <strong className="tnum" style={{ color: 'var(--text)' }}>{formatHours(b.hours)}</strong>
              <span>created {fmtDate(b.createdAt)} -&gt; resolved {fmtDate(b.resolvedAt)}</span>
            </div>
          </li>
        ))}
      </ol>
      <MoreRow shown={vis.length} total={rows.length} onMore={() => setN((x) => x + STEP)} />
    </>
  );
}

function ReopenList({ items }: { items: ReopenRow[] }) {
  const [n, setN] = useState(STEP);
  if (items.length === 0) return <Empty icon="✓" title="No bugs were reopened">Nothing moved back from a resolved stage in this window.</Empty>;
  const vis = items.slice(0, n);
  return (
    <>
      <ul className="qp-list" aria-label="Recently reopened bugs">
        {vis.map((b) => (
          <li key={b.key} className="qp-row">
            <div className="qp-l1">
              <IssueLink k={b.key} url={b.url} />
              <span className="qp-sum" title={b.summary}>{b.summary}</span>
            </div>
            <div className="qp-l2">
              <PriorityTag p={b.priority} />
              <span title={fmtDateTime(b.lastReopenedAt)}>moved back from {b.from} to {b.to}{b.by ? ` by ${b.by}` : ''} on {fmtDate(b.lastReopenedAt)}</span>
              {b.times > 1 && <span className="vchip tnum">reopened {b.times} times</span>}
              {b.assignee ? <span>{b.assignee}</span> : <span style={{ fontStyle: 'italic' }}>Unassigned</span>}
            </div>
          </li>
        ))}
      </ul>
      <MoreRow shown={vis.length} total={items.length} onMore={() => setN((x) => x + STEP)} />
    </>
  );
}

function ChartCard({ title, wide, empty, children }: { title: string; wide?: boolean; empty?: string | null; children: ReactNode }) {
  return (
    <div className={wide ? 'qp-wide' : undefined} style={{ minWidth: 0, display: 'flex' }}>
      <section className="card" style={{ flex: 1, minWidth: 0 }}>
        <div className="card-h"><h3>{title}</h3></div>
        {empty ? <Empty>{empty}</Empty> : children}
      </section>
    </div>
  );
}

export default function QualityPanel({ initialDays = 60 }: { initialDays?: number }) {
  const [win, setWin] = useState(initialDays);
  const [data, setData] = useState<QualityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const reqSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++reqSeq.current;
    try {
      const res = await fetch(`/api/jira/quality?days=${win}`, { cache: 'no-store' });
      let body: (Partial<QualityResponse> & { error?: string }) | null = null;
      try { body = (await res.json()) as Partial<QualityResponse> & { error?: string }; } catch { body = null; }
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      if (!body || typeof body !== 'object') throw new Error('Invalid response');
      if (seq !== reqSeq.current) return;
      if (body.jiraError) { setError(body.jiraError); setLoading(false); return; }
      setData(body as QualityResponse); setError(null); setLoading(false); setUpdatedAt(Date.now());
    } catch (e) {
      if (seq !== reqSeq.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load quality data');
      setLoading(false);
    }
  }, [win]);

  useEffect(() => {
    const first = setTimeout(() => { void load(); }, 0);
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, POLL_MS);
    const onRefresh = () => { void load(); };
    window.addEventListener('tracker:refresh', onRefresh);
    window.addEventListener('tracker:auth-changed', onRefresh);
    return () => {
      clearTimeout(first); clearInterval(t);
      window.removeEventListener('tracker:refresh', onRefresh);
      window.removeEventListener('tracker:auth-changed', onRefresh);
    };
  }, [load]);

  const changeWindow = (d: number) => { setData(null); setError(null); setLoading(true); setWin(d); };
  const retry = () => { setLoading(true); setError(null); void load(); };
  const options = WINDOWS.includes(initialDays) ? WINDOWS : [...WINDOWS, initialDays].sort((a, b) => a - b);
  const upd = updatedAt != null ? new Date(updatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : null;

  const ttr = data?.ttr;
  const re = data?.reopened;
  const noneResolved = !!ttr && ttr.count === 0;
  const prevIncomplete = data?.previousComplete === false;
  const cohort = (re as (typeof re & { cohort?: { resolved: number; reopened: number } }) | undefined)?.cohort;

  let body: ReactNode;
  if (error && !data) {
    body = <ErrorNote onRetry={retry} detail={error}>Could not load quality data.</ErrorNote>;
  } else if (loading || !data || !ttr || !re) {
    body = (
      <div role="group" aria-busy="true" aria-label="Loading quality data">
        <Skeleton variant="tile" height={72} />
        <div className="qp-grid">{[0, 1, 2, 3].map((i) => <div key={i} className={i === 0 || i === 3 ? 'qp-wide' : undefined}><Skeleton variant="tile" height={220} /></div>)}</div>
        <div className="qp-lists"><Skeleton variant="rows" rows={4} height={48} /><Skeleton variant="rows" rows={4} height={48} /></div>
      </div>
    );
  } else if (!data.configured) {
    body = <p className="muted" role="note" style={{ margin: '8px 0' }}>Jira is not configured.</p>;
  } else {
    body = (
      <>
        {error && <ErrorNote onRetry={retry} detail={error}>Could not refresh; showing the last loaded data.</ErrorNote>}
        {data.jiraError && <ErrorNote>Jira data unavailable: {data.jiraError}</ErrorNote>}
        {data.truncated && (
          <div className="banner" role="note" style={{ padding: '5px 12px', fontSize: 'var(--fs-xs)' }}>
            <span aria-hidden="true">! </span>Some counts may be incomplete: this window has more bugs than the dashboard fetches. Choose a shorter window for exact numbers.
          </div>
        )}
        <Card>
          <div role="group" aria-label="Quality headline numbers" className="qp-strip">
            <Stat label="Median time to resolve" value={formatHours(ttr.medianHours)} extra={<Delta now={ttr.medianHours} before={ttr.previous?.medianHours} incomplete={prevIncomplete} />} />
            <Stat label="Mean" value={formatHours(ttr.meanHours)} extra={<Delta now={ttr.meanHours} before={ttr.previous?.meanHours} incomplete={prevIncomplete} />} />
            <Stat label="90th percentile" value={formatHours(ttr.p90Hours)} extra={<span className="muted">9 in 10 bugs faster</span>} />
            <Stat label="Bugs resolved" value={ttr.count} extra={<CountDelta now={ttr.count} before={ttr.previous?.count} incomplete={prevIncomplete} />} />
            <Stat label="Reopen rate" value={<RateBadge rate={re.rate} previous={prevIncomplete ? null : re.previous?.rate ?? null} />} extra={<span className="muted">{cohort ? `${cohort.reopened} of ${cohort.resolved} resolved bugs were reopened` : 'of resolved bugs'}{prevIncomplete ? ' · previous period incomplete' : ''}</span>} />
            <Stat label="Bugs reopened" value={re.bugs} extra={<CountDelta now={re.bugs} before={re.previous?.bugs} incomplete={prevIncomplete} />} />
            <Stat label="Reopen events" value={re.events} extra={<CountDelta now={re.events} before={re.previous?.events} incomplete={prevIncomplete} />} />
          </div>
        </Card>

        <div className="qp-grid">
          <ChartCard wide title="Time to resolve by week" empty={noneResolved ? 'No bugs were resolved in this window.' : null}>
            <TtrTrendChart weeks={ttr.byWeek} asOf={data.generatedAt} />
          </ChartCard>
          <ChartCard title="Median time to resolve by priority" empty={noneResolved ? 'No bugs were resolved in this window.' : null}>
            <TtrByPriority data={ttr.byPriority} />
          </ChartCard>
          <ChartCard title="How long bugs take" empty={noneResolved ? 'No bugs were resolved in this window.' : null}>
            <TtrDistribution data={ttr.distribution} />
          </ChartCard>
          <ChartCard wide title="Reopened bugs by week">
            <ReopenTrendChart weeks={re.byWeek} asOf={data.generatedAt} />
          </ChartCard>
        </div>

        <div className="qp-lists">
          <section className="card" style={{ minWidth: 0 }}>
            <div className="card-h"><h3>Slowest to resolve</h3></div>
            <SlowList items={ttr.slowest} />
          </section>
          <section className="card" style={{ minWidth: 0 }}>
            <div className="card-h"><h3>Recently reopened</h3></div>
            <ReopenList items={re.recent} />
          </section>
        </div>
      </>
    );
  }

  return (
    <section className="fade-in" aria-label="Quality: time to resolve and reopened bugs" style={{ marginTop: 24 }}>
      <style>{CSS}</style>
      <div className="section-h">
        <h2 style={{ margin: 0 }}>Quality: time to resolve and reopened bugs</h2>
        <span className="meta" style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <span role="status">{upd ? `updated ${upd}` : loading ? 'Loading…' : ''}</span>
          <select aria-label="Quality time window" style={ctl} value={win} onChange={(e) => changeWindow(Number(e.target.value))}>
            {options.map((d) => <option key={d} value={d}>{d} days</option>)}
          </select>
        </span>
      </div>
      <p className="subtle" style={{ margin: '0 0 12px' }}>Resolved = reached QA Passed or any later stage. Time to resolve = created until the first time a bug reached QA Passed.</p>
      {body}
    </section>
  );
}
