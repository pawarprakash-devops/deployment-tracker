'use client';
// Hand-written SVG/CSS charts for the Tickets tab. No chart library. Each export returns content only (no Card),
// has a quiet empty state, and a text alternative (role="img" + aria-label, plus a visually hidden table).
import { useId, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react';
import type { DayPoint } from '@/lib/tickets-types';

type Tone = 'ok' | 'bad' | 'warn' | 'info' | 'neutral';

const BAD = 'var(--bad, #dc2626)';
const OK = 'var(--ok, #15803d)';
const WARN = 'var(--warn, #b45309)';
const INFO = 'var(--info, #2563eb)';
const MUTED = 'var(--muted, #57534c)';
const FAINT = 'var(--faint, #65615a)';
const TEXT = 'var(--text, #1c1a17)';
const BORDER = 'var(--border, rgba(40,30,15,0.11))';
const FONT_DATA = 'var(--font-data, ui-monospace, SFMono-Regular, Menlo, monospace)';

const TONE_FILL: Record<Tone, string> = { ok: OK, bad: BAD, warn: WARN, info: INFO, neutral: 'var(--neutral, #8a8378)' };
const TONE_TEXT: Record<Tone, string> = {
  ok: 'var(--ok-text, #166534)', bad: 'var(--bad-text, #b91c1c)', warn: 'var(--warn-text, #8a4204)',
  info: 'var(--info-text, #1d4ed8)', neutral: MUTED,
};
const TONE_BG: Record<Tone, string> = {
  ok: 'var(--ok-bg, #e6f0e8)', bad: 'var(--bad-bg, #fae7e6)', warn: 'var(--warn-bg, #f6ebe3)',
  info: 'var(--info-bg, #e7edf9)', neutral: 'transparent',
};
const TONE_BORDER: Record<Tone, string> = {
  ok: 'var(--ok-border, rgba(21,128,61,0.32))', bad: 'var(--bad-border, rgba(220,38,38,0.32))',
  warn: 'var(--warn-border, rgba(180,83,9,0.32))', info: 'var(--info-border, rgba(37,99,235,0.32))', neutral: BORDER,
};

const VISUALLY_HIDDEN: CSSProperties = {
  position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden',
  clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};

function Empty({ children }: { children: ReactNode }) {
  return <p style={{ margin: 0, padding: '14px 0', fontSize: 13, lineHeight: '18px', color: MUTED }}>{children}</p>;
}

function HiddenTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    // the wrapper (not the table) is the 1px clipped box: a <table> ignores width/height/overflow, so a hidden
    // table would otherwise add its full height to the scrollable area of the card around it
    <div style={VISUALLY_HIDDEN}><table>
      <caption>{caption}</caption>
      <thead><tr>{head.map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}</tr>)}</tbody>
    </table></div>
  );
}

// ---- date helpers (series dates are UTC YYYY-MM-DD) ------------------------------------------------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function parseDay(s: string): { d: number; m: number; wd: number } | null {
  const mt = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!mt) return null;
  const dt = new Date(Date.UTC(+mt[1], +mt[2] - 1, +mt[3]));
  return { d: +mt[3], m: +mt[2] - 1, wd: dt.getUTCDay() };
}
const pad2 = (n: number) => String(n).padStart(2, '0');
const shortLabel = (s: string) => { const p = parseDay(s); return p ? `${pad2(p.d)} ${MONTHS[p.m]}` : s; };
const longLabel = (s: string) => { const p = parseDay(s); return p ? `${WEEKDAYS[p.wd]} ${pad2(p.d)}/${pad2(p.m + 1)}` : s; };
const plural = (n: number, w: string) => `${n} ${w}`;

// ---- (1) BugFlowChart ------------------------------------------------------------------------------
const VB_W = 720;
const GUTTER = 30; // px, HTML y-axis labels (never scaled)

export function BugFlowChart({ series, height = 180 }: { series: DayPoint[]; height?: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [active, setActive] = useState<number | null>(null);
  const n = series.length;
  const raisedTotal = series.reduce((a, d) => a + d.created, 0);
  const resolvedTotal = series.reduce((a, d) => a + d.resolved, 0);
  if (n === 0 || raisedTotal + resolvedTotal === 0) return <Empty>No bugs raised or resolved in this window.</Empty>;

  const max = Math.max(1, ...series.map(d => Math.max(d.created, d.resolved)));
  const half = height / 2;
  const slot = VB_W / n;
  const bw = Math.max(1.5, Math.min(26, slot * 0.7));
  const scale = (v: number) => (v / max) * (half - 3);
  const step = Math.max(1, Math.ceil(n / 6)); // ~6 x labels at any width; HTML so text never scales
  const cur = active == null ? null : Math.min(Math.max(active, 0), n - 1);
  const label = `Bugs raised and resolved per day, ${shortLabel(series[0].date)} to ${shortLabel(series[n - 1].date)}: ${plural(raisedTotal, 'raised')}, ${plural(resolvedTotal, 'resolved')}.`;

  const onPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width <= 0) return;
    setActive(Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n))));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const base = cur ?? n - 1;
    let next: number | null = null;
    if (e.key === 'ArrowLeft') next = Math.max(0, base - 1);
    else if (e.key === 'ArrowRight') next = Math.min(n - 1, base + 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    else if (e.key === 'Escape') { setActive(null); return; }
    if (next == null) return;
    e.preventDefault();
    setActive(cur == null && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') ? n - 1 : next);
  };
  const yLabel: CSSProperties = { position: 'absolute', right: 6, transform: 'translateY(-50%)', fontSize: 12, lineHeight: '14px', color: MUTED, fontFamily: FONT_DATA };

  return (
    <div style={{ position: 'relative' }}>
      <div role="img" aria-label={label}>
        <div
          tabIndex={0}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
          style={{ position: 'relative', paddingLeft: GUTTER, outlineOffset: 2 }}
          aria-label="Day-by-day bug chart. Use left and right arrow keys to inspect a day."
        >
          <span aria-hidden="true" style={{ ...yLabel, top: 0 + 7, width: GUTTER - 6, textAlign: 'right', left: 0 }}>{max}</span>
          <span aria-hidden="true" style={{ ...yLabel, top: '50%', width: GUTTER - 6, textAlign: 'right', left: 0 }}>0</span>
          <span aria-hidden="true" style={{ ...yLabel, top: 'calc(100% - 7px)', width: GUTTER - 6, textAlign: 'right', left: 0 }}>{max}</span>
          <div
            onPointerMove={onPointer}
            onPointerLeave={() => setActive(null)}
            style={{ position: 'relative', touchAction: 'pan-y' }}
          >
            <svg viewBox={`0 0 ${VB_W} ${height}`} width="100%" style={{ display: 'block', height: 'auto', overflow: 'visible' }} aria-hidden="true" focusable="false">
              <defs>
                <pattern id={`hatch${uid}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="6" height="6" fill={OK} fillOpacity="0.22" />
                  <line x1="0" y1="0" x2="0" y2="6" stroke={OK} strokeWidth="2.6" />
                </pattern>
              </defs>
              <line x1="0" y1="0.5" x2={VB_W} y2="0.5" stroke={BORDER} vectorEffect="non-scaling-stroke" />
              <line x1="0" y1={height - 0.5} x2={VB_W} y2={height - 0.5} stroke={BORDER} vectorEffect="non-scaling-stroke" />
              {cur != null && <rect x={cur * slot} y="0" width={slot} height={height} fill={MUTED} fillOpacity="0.12" />}
              {series.map((d, i) => {
                const x = i * slot + (slot - bw) / 2;
                const up = scale(d.created);
                const down = scale(d.resolved);
                return (
                  <g key={d.date}>
                    {d.created > 0 && (
                      <rect x={x} y={half - up} width={bw} height={up} rx="1.5" fill={BAD} fillOpacity="0.85">
                        <title>{`${longLabel(d.date)}: ${plural(d.created, 'raised')}`}</title>
                      </rect>
                    )}
                    {d.resolved > 0 && (
                      <rect x={x} y={half} width={bw} height={down} rx="1.5" fill={`url(#hatch${uid})`} stroke={OK} strokeWidth="1" vectorEffect="non-scaling-stroke">
                        <title>{`${longLabel(d.date)}: ${plural(d.resolved, 'resolved')}`}</title>
                      </rect>
                    )}
                  </g>
                );
              })}
              <line x1="0" y1={half} x2={VB_W} y2={half} stroke={MUTED} strokeOpacity="0.6" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
          <div aria-hidden="true" style={{ position: 'relative', height: 18, marginTop: 4 }}>
            {series.map((d, i) => {
              if (i % step !== 0 && i !== n - 1) return null;
              if (i !== n - 1 && n - 1 - i < step * 0.7) return null; // avoid crowding the final label
              const pct = ((i + 0.5) / n) * 100;
              const edge = pct < 8 ? 'translateX(0)' : pct > 92 ? 'translateX(-100%)' : 'translateX(-50%)';
              const keepSmall = i === n - 1 || (i % (step * 2) === 0 && n - 1 - i >= step * 1.4); // fewer labels on narrow screens
              return <span key={d.date} className={keepSmall ? 'tnum' : 'tnum cx-wide'} style={{ position: 'absolute', left: `${pct}%`, transform: edge, fontSize: 12, lineHeight: '16px', color: MUTED, whiteSpace: 'nowrap' }}>{shortLabel(d.date)}</span>;
            })}
          </div>
        </div>
      </div>
      <p aria-live="polite" className="tnum" style={{ margin: '4px 0 0', minHeight: 18, paddingLeft: GUTTER, fontSize: 13, lineHeight: '18px', color: cur == null ? FAINT : TEXT }}>
        {cur == null ? 'Hover or focus the chart and use arrow keys to see a day.' : `${longLabel(series[cur].date)}: ${series[cur].created} raised, ${series[cur].resolved} resolved`}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', marginTop: 6, paddingLeft: GUTTER, fontSize: 13, lineHeight: '18px', color: TEXT }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <svg width="14" height="12" aria-hidden="true"><rect width="14" height="12" rx="2" fill={BAD} fillOpacity="0.85" /></svg>
          <span>raised <b className="tnum" style={{ fontFamily: FONT_DATA }}>{raisedTotal}</b></span>
          <span style={{ color: MUTED }}>(up)</span>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <svg width="14" height="12" aria-hidden="true">
            <defs><pattern id={`lg${uid}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill={OK} fillOpacity="0.22" /><line x1="0" y1="0" x2="0" y2="5" stroke={OK} strokeWidth="2.2" /></pattern></defs>
            <rect x="0.5" y="0.5" width="13" height="11" rx="2" fill={`url(#lg${uid})`} stroke={OK} />
          </svg>
          <span>resolved <b className="tnum" style={{ fontFamily: FONT_DATA }}>{resolvedTotal}</b></span>
          <span style={{ color: MUTED }}>(down)</span>
        </span>
      </div>
      <style>{'@media (max-width: 560px) { .cx-wide { display: none; } }'}</style>
      <HiddenTable caption="Bugs per day" head={['Day', 'Raised', 'Resolved']} rows={series.map(d => [d.date, d.created, d.resolved])} />
    </div>
  );
}

// ---- (2) PriorityBars ------------------------------------------------------------------------------
function priorityTone(p: string): { tone: Tone; tag: string } {
  const k = p.trim().toLowerCase();
  if (k === 'highest' || k === 'high' || k === 'blocker' || k === 'critical' || k === 'major') return { tone: 'bad', tag: 'urgent' };
  if (k === 'medium') return { tone: 'warn', tag: 'normal' };
  if (k === 'low' || k === 'lowest' || k === 'minor' || k === 'trivial') return { tone: 'info', tag: 'minor' };
  return { tone: 'neutral', tag: 'unset' };
}

export function PriorityBars({ data }: { data: { priority: string; count: number }[] }) {
  const total = data.reduce((a, d) => a + d.count, 0);
  if (data.length === 0 || total === 0) return <Empty>No open bugs.</Empty>;
  const max = Math.max(1, ...data.map(d => d.count));
  const label = `Open bugs by priority: ${data.map(d => `${d.priority} ${d.count}`).join(', ')}.`;
  return (
    <div>
      <div role="img" aria-label={label} style={{ display: 'grid', gap: 8 }}>
        {data.map(d => {
          const { tone, tag } = priorityTone(d.priority);
          return (
            <div key={d.priority} aria-hidden="true" style={{ display: 'grid', gridTemplateColumns: 'minmax(64px, 96px) 1fr 40px', alignItems: 'center', columnGap: 10 }}>
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontSize: 13, lineHeight: '16px', color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.priority}</span>
                <span style={{ fontSize: 12, lineHeight: '14px', color: TONE_TEXT[tone] }}>{tag}</span>
              </span>
              <span style={{ display: 'block', height: 12, borderRadius: 3, background: TONE_BG[tone], border: `1px solid ${TONE_BORDER[tone]}`, overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: `${(d.count / max) * 100}%`, background: TONE_FILL[tone], opacity: tone === 'neutral' ? 0.55 : 0.9 }} />
              </span>
              <span className="mono tnum" style={{ textAlign: 'right', fontSize: 13, lineHeight: '16px', color: TEXT, fontFamily: FONT_DATA }}>{d.count}</span>
            </div>
          );
        })}
      </div>
      <HiddenTable caption="Open bugs by priority" head={['Priority', 'Count']} rows={data.map(d => [d.priority, d.count])} />
    </div>
  );
}

// ---- (3) AgeBuckets --------------------------------------------------------------------------------
export function AgeBuckets({ data }: { data: { bucket: string; count: number }[] }) {
  const total = data.reduce((a, d) => a + d.count, 0);
  if (data.length === 0 || total === 0) return <Empty>No open bugs to age.</Empty>;
  const max = Math.max(1, ...data.map(d => d.count));
  const last = data.length - 1;
  // Progressive severity: young = info, then warn, oldest two = bad (with an hatch on the oldest for non-colour cue).
  const toneAt = (i: number): Tone => (i === 0 ? 'info' : i <= Math.floor(last / 2) ? 'warn' : 'bad');
  const label = `Open bugs by age: ${data.map(d => `${d.bucket} ${d.count}`).join(', ')}.`;
  const H = 84;
  return (
    <div>
      <div role="img" aria-label={label} aria-hidden={undefined} style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
        {data.map((d, i) => {
          const tone = toneAt(i);
          const h = d.count === 0 ? 2 : Math.max(4, (d.count / max) * H);
          return (
            <div key={d.bucket} aria-hidden="true" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span className="mono tnum" style={{ fontSize: 13, lineHeight: '18px', fontWeight: 600, color: TEXT, fontFamily: FONT_DATA }}>{d.count}</span>
              <span style={{ width: '100%', maxWidth: 44, height: h, borderRadius: '3px 3px 0 0', background: TONE_FILL[tone], opacity: d.count === 0 ? 0.3 : 0.88, backgroundImage: i === last && d.count > 0 ? 'repeating-linear-gradient(45deg, rgba(255,255,255,0.35) 0 2px, transparent 2px 6px)' : undefined }} />
              <span style={{ marginTop: 4, width: '100%', borderTop: `1px solid ${BORDER}`, paddingTop: 4, textAlign: 'center', fontSize: 12, lineHeight: '14px', color: MUTED, overflowWrap: 'anywhere' }}>{d.bucket}</span>
            </div>
          );
        })}
      </div>
      <HiddenTable caption="Open bugs by age" head={['Age', 'Count']} rows={data.map(d => [d.bucket, d.count])} />
    </div>
  );
}

// ---- (4) StageBars ---------------------------------------------------------------------------------
export function StageBars({ stages }: { stages: { name: string; count: number }[] }) {
  const total = stages.reduce((a, s) => a + s.count, 0);
  if (stages.length === 0 || total === 0) return <Empty>No tickets in the delivery flow.</Empty>;
  const max = Math.max(1, ...stages.map(s => s.count));
  const label = `Delivery flow: ${stages.map(s => `${s.name} ${s.count}`).join(', ')}.`;
  return (
    <div>
      <div role="img" aria-label={label}>
        {stages.map((s, i) => {
          const pct = Math.round((s.count / total) * 100);
          return (
            <div key={s.name} aria-hidden="true">
              {i > 0 && <div style={{ height: 10, display: 'flex', alignItems: 'center', paddingLeft: 'calc(min(38%, 130px) + 10px)', color: FAINT }}>
                <svg width="12" height="8" viewBox="0 0 12 8" focusable="false"><polyline points="1.5,1.5 6,6 10.5,1.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </div>}
              <div style={{ display: 'grid', gridTemplateColumns: 'min(38%, 130px) 1fr auto', alignItems: 'center', columnGap: 10 }}>
                <span style={{ fontSize: 13, lineHeight: '16px', color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.name}>{s.name}</span>
                <span style={{ display: 'block', height: 14, borderRadius: 3, background: 'var(--info-bg, #e7edf9)', border: `1px solid var(--info-border, rgba(37,99,235,0.32))`, overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: '100%', width: `${(s.count / max) * 100}%`, background: INFO, opacity: 0.85 }} />
                </span>
                <span className="mono tnum" style={{ minWidth: 64, textAlign: 'right', fontSize: 13, lineHeight: '16px', color: TEXT, fontFamily: FONT_DATA }}>
                  {s.count} <span style={{ color: MUTED }}>{pct}%</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <HiddenTable caption="Tickets by delivery stage" head={['Stage', 'Count', 'Percent of total']} rows={stages.map(s => [s.name, s.count, `${Math.round((s.count / total) * 100)}%`])} />
    </div>
  );
}

// ---- (5) Sparkline ---------------------------------------------------------------------------------
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const W = 100;
  const H = 28;
  const hasData = values.length > 0 && values.some(v => v !== 0);
  if (!hasData) {
    return <span role="img" aria-label={`${label}: no data`} style={{ display: 'inline-block', width: W, height: H, borderBottom: `1px dashed ${BORDER}` }} />;
  }
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => {
    const x = values.length === 1 ? W / 2 : (i / (values.length - 1)) * W;
    const y = H - 3 - ((v - lo) / span) * (H - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const lastPt = pts[pts.length - 1].split(',');
  return (
    <svg role="img" aria-label={`${label}: ${values.join(', ')}`} width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'inline-block', verticalAlign: 'middle', overflow: 'visible' }}>
      <polyline points={pts.join(' ')} fill="none" stroke={INFO} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lastPt[0]} cy={lastPt[1]} r="2.2" fill={INFO} />
    </svg>
  );
}

// ---- (6) Delta -------------------------------------------------------------------------------------
export function Delta({ now, before, goodWhen = 'down' }: { now: number; before: number; goodWhen?: 'up' | 'down' }) {
  let text: string;
  let tone: Tone = 'neutral';
  let words: string;
  if (now === before) {
    text = '— same';
    words = 'unchanged';
  } else {
    const up = now > before;
    const pct = before === 0 ? null : Math.round((Math.abs(now - before) / before) * 100);
    const amount = pct == null ? `${Math.abs(now - before)}` : `${pct}%`;
    text = `${up ? '▲' : '▼'} ${amount}`;
    words = `${up ? 'up' : 'down'} ${amount}`;
    tone = up === (goodWhen === 'up') ? 'ok' : 'bad';
  }
  return (
    <span
      className="tnum"
      title={`${words} (${before} to ${now})`}
      style={{ display: 'inline-block', padding: '0 6px', borderRadius: 999, fontSize: 12, lineHeight: '18px', fontWeight: 600, whiteSpace: 'nowrap', color: TONE_TEXT[tone], background: TONE_BG[tone], border: `1px solid ${TONE_BORDER[tone]}`, fontFamily: FONT_DATA }}
    >
      <span aria-hidden="true">{text}</span>
      <span style={VISUALLY_HIDDEN}>{`${words}${tone === 'ok' ? ', improving' : tone === 'bad' ? ', worsening' : ''}`}</span>
    </span>
  );
}
