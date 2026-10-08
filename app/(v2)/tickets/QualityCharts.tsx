'use client';
// Hand-written SVG/HTML charts for the Tickets "Quality" panel (time to resolve + reopened bugs). No chart library.
// Same conventions as Charts.tsx: content only (the parent wraps it in a Card), quiet empty states, role="img" +
// aria-label summary, a visually hidden data table, HTML text labels (never scaled), status never by colour alone.
import { useId, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react';
import type { ReopenWeek, TtrPriorityRow, TtrWeek } from '@/lib/tickets-types';

type Tone = 'ok' | 'bad' | 'warn' | 'info' | 'neutral';

const BAD = 'var(--bad, #dc2626)';
const OK = 'var(--ok, #15803d)';
const WARN = 'var(--warn, #b45309)';
const INFO = 'var(--info, #2563eb)';
const MUTED = 'var(--muted, #57534c)';
const FAINT = 'var(--faint, #65615a)';
const TEXT = 'var(--text, #1c1a17)';
const BORDER = 'var(--border, rgba(40,30,15,0.11))';
const PANEL = 'var(--panel, #fdfcfb)';
const NEUTRAL = 'var(--neutral, #64748b)';
const FONT_DATA = 'var(--font-data, ui-monospace, SFMono-Regular, Menlo, monospace)';

const TONE_FILL: Record<Tone, string> = { ok: OK, bad: BAD, warn: WARN, info: INFO, neutral: NEUTRAL };
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
    // the wrapper (not the table) is the 1px clipped box: a <table> ignores width/height/overflow
    <div style={VISUALLY_HIDDEN}><table>
      <caption>{caption}</caption>
      <thead><tr>{head.map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}</tr>)}</tbody>
    </table></div>
  );
}

// ---- formatting ------------------------------------------------------------------------------------
const trim1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '');

/** null -> '—'; < 1 h -> '42 min'; < 48 h -> '7.5 h'; otherwise days with one decimal, '3.2 d'. */
export function formatHours(h: number | null | undefined): string {
  if (h == null || !Number.isFinite(h)) return '—';
  const v = Math.max(0, h);
  if (v < 1) {
    const m = Math.round(v * 60);
    return m >= 60 ? '1 h' : `${m} min`;
  }
  if (v < 48) return `${trim1(v)} h`;
  return `${trim1(v / 24)} d`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function parseDay(s: string): { d: number; m: number } | null {
  const mt = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return mt ? { d: +mt[3], m: +mt[2] - 1 } : null;
}
const pad2 = (n: number) => String(n).padStart(2, '0');
const shortLabel = (s: string) => { const p = parseDay(s); return p ? `${pad2(p.d)} ${MONTHS[p.m]}` : s; };
const dmLabel = (s: string) => { const p = parseDay(s); return p ? `${pad2(p.d)}/${pad2(p.m + 1)}` : s; };
const bugs = (n: number) => `${n} ${n === 1 ? 'bug' : 'bugs'}`;
const pct = (r: number) => `${Math.round(r * 100)}%`;
const WEEK_MS = 7 * 86_400_000;

/** ' (partial week)' for the first bucket (starts before the window) and for the week still in progress at `asOf`. */
function partialTag(weeks: { week: string }[], i: number, asOf?: string): string {
  if (i === 0) return ' (partial week)';
  if (i === weeks.length - 1) {
    const start = Date.parse(`${weeks[i].week}T00:00:00Z`);
    const now = asOf ? Date.parse(asOf) : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(now) || (now >= start && now < start + WEEK_MS)) return ' (partial week)';
  }
  return '';
}

/** Round a positive maximum up to a tidy axis value (1, 2, 2.5, 4, 5, 10 x 10^k). */
function niceCeil(v: number): number {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 4, 5, 10]) if (v <= m * p + 1e-9) return m * p;
  return 10 * p;
}

/** Push label centres apart (min gap) and keep them inside [lo, hi]. Returns adjusted y per input index. */
function spreadLabels(ys: number[], lo: number, hi: number, gap = 16): number[] {
  const order = ys.map((y, i) => i).sort((a, b) => ys[a] - ys[b]);
  const out = ys.slice();
  let prev = lo - gap;
  for (const i of order) { out[i] = Math.max(ys[i], prev + gap, lo); prev = out[i]; }
  let next = hi + gap;
  for (const i of order.slice().reverse()) { out[i] = Math.min(out[i], next - gap, hi); next = out[i]; }
  return out;
}

/** Line path that breaks wherever a value is null (a week with no data is a gap, never a zero). */
function gapPath(pts: ({ x: number; y: number } | null)[]): string {
  let d = '';
  let pen = false;
  for (const p of pts) {
    if (!p) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    pen = true;
  }
  return d;
}

// ---- shared weekly frame: axes, x labels, hover + keyboard readout ----------------------------------
const VB_W = 720;
const PT = 10; // px headroom above the plot
const PB = 2;

interface Tick { y: number; text: string }

interface FrameProps {
  n: number;
  dates: string[];
  height: number;
  left: number;
  right: number;
  label: string;
  navLabel: string;
  readout: (i: number) => string;
  leftTicks: Tick[];
  rightTicks?: Tick[];
  draw: ReactNode; // SVG children (viewBox is VB_W x height, stretched horizontally only)
  overlay?: ReactNode; // HTML positioned inside the plot box (dots, end labels)
  legend: ReactNode;
  table: ReactNode;
}

function WeekFrame(p: FrameProps) {
  const { n, dates, height, left, right } = p;
  const [active, setActive] = useState<number | null>(null);
  const cur = active == null ? null : Math.min(Math.max(active, 0), n - 1);
  const slot = VB_W / n;
  const step = Math.max(1, Math.ceil(n / 6));

  const onPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width <= 0) return;
    setActive(Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n))));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const base = cur ?? n - 1;
    if (e.key === 'Escape') { setActive(null); return; }
    let next: number | null = null;
    if (e.key === 'ArrowLeft') next = cur == null ? n - 1 : Math.max(0, base - 1);
    else if (e.key === 'ArrowRight') next = cur == null ? n - 1 : Math.min(n - 1, base + 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next == null) return;
    e.preventDefault();
    setActive(next);
  };
  const tickStyle: CSSProperties = { position: 'absolute', transform: 'translateY(-50%)', fontSize: 12, lineHeight: '14px', color: MUTED, fontFamily: FONT_DATA, whiteSpace: 'nowrap' };

  return (
    <div style={{ position: 'relative' }}>
      <div>
        <div tabIndex={0} role="img" aria-roledescription="chart" onKeyDown={onKey} onBlur={() => setActive(null)} style={{ outlineOffset: 2 }} aria-label={`${p.label} ${p.navLabel}`}>
          <div
            onPointerMove={onPointer}
            onPointerLeave={() => setActive(null)}
            style={{ position: 'relative', marginLeft: left, marginRight: right, height, touchAction: 'pan-y' }}
          >
            {p.leftTicks.map(t => <span key={`l${t.y}`} aria-hidden="true" style={{ ...tickStyle, top: t.y, right: '100%', marginRight: 6 }}>{t.text}</span>)}
            {(p.rightTicks ?? []).map(t => <span key={`r${t.y}`} aria-hidden="true" style={{ ...tickStyle, top: t.y, left: '100%', marginLeft: 6 }}>{t.text}</span>)}
            <svg viewBox={`0 0 ${VB_W} ${height}`} preserveAspectRatio="none" width="100%" height={height} style={{ position: 'absolute', inset: 0, display: 'block', overflow: 'visible' }} aria-hidden="true" focusable="false">
              {p.leftTicks.map(t => <line key={t.y} x1="0" x2={VB_W} y1={t.y} y2={t.y} stroke={BORDER} vectorEffect="non-scaling-stroke" />)}
              {cur != null && <rect x={cur * slot} y="0" width={slot} height={height} fill={MUTED} fillOpacity="0.12" />}
              {p.draw}
            </svg>
            {p.overlay}
          </div>
          <div aria-hidden="true" style={{ position: 'relative', height: 18, marginTop: 4, marginLeft: left, marginRight: right }}>
            {dates.map((d, i) => {
              if (i % step !== 0 && i !== n - 1) return null;
              if (i !== n - 1 && n - 1 - i < step * 0.7) return null; // keep the final label uncrowded
              const x = ((i + 0.5) / n) * 100;
              const edge = x < 8 ? 'translateX(0)' : x > 92 ? 'translateX(-100%)' : 'translateX(-50%)';
              const keep = i === n - 1 || (i % (step * 2) === 0 && n - 1 - i >= step * 1.4); // fewer labels on narrow screens
              return <span key={d} className={keep ? 'tnum' : 'tnum cx-wide'} style={{ position: 'absolute', left: `${x}%`, transform: edge, fontSize: 12, lineHeight: '16px', color: MUTED, whiteSpace: 'nowrap' }}>{shortLabel(d)}</span>;
            })}
          </div>
        </div>
      </div>
      <p aria-live="polite" className="tnum" style={{ margin: '4px 0 0', minHeight: 18, paddingLeft: left, fontSize: 13, lineHeight: '18px', color: cur == null ? FAINT : TEXT }}>
        {cur == null ? 'Hover or focus the chart and use arrow keys to see a week.' : p.readout(cur)}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', marginTop: 6, paddingLeft: left, fontSize: 13, lineHeight: '18px', color: TEXT }}>{p.legend}</div>
      <p style={{ margin: '4px 0 0', paddingLeft: left, fontSize: 12, lineHeight: '16px', color: MUTED }}>First and latest weeks are partial.</p>
      <style>{'@media (max-width: 560px) { .cx-wide { display: none; } } @media (max-width: 420px) { .cx-ends { display: none; } }'}</style>
      {p.table}
    </div>
  );
}

function LegendItem({ swatch, children }: { swatch: ReactNode; children: ReactNode }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{swatch}<span>{children}</span></span>;
}

function LineSwatch({ color, dashed, thin }: { color: string; dashed?: boolean; thin?: boolean }) {
  return (
    <svg width="22" height="12" aria-hidden="true" focusable="false">
      <line x1="1" y1="6" x2="21" y2="6" stroke={color} strokeWidth={thin ? 1.5 : 2.5} strokeDasharray={dashed ? '4 3' : undefined} strokeLinecap="round" />
    </svg>
  );
}

function Dot({ x, y, color, title }: { x: number; y: number; color: string; title: string }) {
  return <span title={title} style={{ position: 'absolute', left: `${x}%`, top: y, width: 10, height: 10, transform: 'translate(-50%, -50%)', borderRadius: '50%', background: color, border: `2px solid ${PANEL}`, boxSizing: 'content-box' }} />;
}

// ---- (2) TtrTrendChart -----------------------------------------------------------------------------
const TTR_LEFT = 46;
const TTR_RIGHT = 96;

export function TtrTrendChart({ weeks, asOf, height = 200 }: { weeks: TtrWeek[]; asOf?: string; height?: number }) {
  const uid = useId();
  const n = weeks.length;
  const total = weeks.reduce((a, w) => a + w.resolved, 0);
  if (n === 0 || total === 0) return <Empty>No bugs were resolved in this window, so there is no time to resolve to chart.</Empty>;

  const H = height;
  const plotH = H - PT - PB;
  const slot = VB_W / n;
  const bw = Math.max(2, Math.min(28, slot * 0.6));
  const hoursMax = Math.max(...weeks.map(w => Math.max(w.medianHours ?? 0, w.meanHours ?? 0)));
  const maxY = niceCeil(Math.max(hoursMax, 0.5));
  const countMax = Math.max(1, ...weeks.map(w => w.resolved));
  const yOf = (v: number) => PT + (1 - v / maxY) * plotH;
  const px = (i: number) => (i + 0.5) * slot;
  const pctX = (i: number) => ((i + 0.5) / n) * 100;
  const hasVal = (w: TtrWeek, k: 'medianHours' | 'meanHours') => w.resolved > 0 && w[k] != null;
  const pts = (k: 'medianHours' | 'meanHours') => weeks.map((w, i) => (hasVal(w, k) ? { x: px(i), y: yOf(w[k] as number) } : null));

  const lastIdx = (k: 'medianHours' | 'meanHours') => { for (let i = n - 1; i >= 0; i--) if (hasVal(weeks[i], k)) return i; return -1; };
  const li = lastIdx('medianHours');
  const lm = lastIdx('meanHours');
  const ends: { text: string; color: string; y: number }[] = [];
  if (li >= 0) ends.push({ text: `median ${formatHours(weeks[li].medianHours)}`, color: TONE_TEXT.info, y: yOf(weeks[li].medianHours as number) });
  if (lm >= 0) ends.push({ text: `mean ${formatHours(weeks[lm].meanHours)}`, color: MUTED, y: yOf(weeks[lm].meanHours as number) });
  const endY = spreadLabels(ends.map(e => e.y), 7, H - 9);

  const latest = li >= 0 ? weeks[li] : null;
  const label = `Weekly time to resolve, week of ${shortLabel(weeks[0].week)} to ${shortLabel(weeks[n - 1].week)}: ${bugs(total)} resolved${latest ? `; latest median ${formatHours(latest.medianHours)}, mean ${formatHours(latest.meanHours)}` : ''}. Weeks with no resolved bugs are gaps.`;

  return (
    <WeekFrame
      n={n}
      dates={weeks.map(w => w.week)}
      height={H}
      left={TTR_LEFT}
      right={TTR_RIGHT}
      label={label}
      navLabel="Weekly time to resolve chart. Use left and right arrow keys to inspect a week."
      readout={i => {
        const w = weeks[i];
        const pw = partialTag(weeks, i, asOf);
        return w.resolved > 0 && w.medianHours != null
          ? `Week of ${dmLabel(w.week)}${pw}: median ${formatHours(w.medianHours)}, mean ${formatHours(w.meanHours)}, ${bugs(w.resolved)} resolved`
          : `Week of ${dmLabel(w.week)}${pw}: no bugs resolved`;
      }}
      leftTicks={[0, 0.5, 1].map(f => ({ y: yOf(maxY * f), text: formatHours(maxY * f).replace(/^0 min$/, '0') }))}
      draw={
        <>
          {weeks.map((w, i) => {
            if (w.resolved <= 0) return null;
            const bh = Math.max(2, (w.resolved / countMax) * plotH * 0.36);
            return (
              <rect key={w.week} x={px(i) - bw / 2} y={H - PB - bh} width={bw} height={bh} rx="1.5" fill={NEUTRAL} fillOpacity="0.28" stroke={NEUTRAL} strokeOpacity="0.55" vectorEffect="non-scaling-stroke">
                <title>{`Week of ${dmLabel(w.week)}${partialTag(weeks, i, asOf)}: ${bugs(w.resolved)} resolved`}</title>
              </rect>
            );
          })}
          <path d={gapPath(pts('meanHours'))} fill="none" stroke={MUTED} strokeWidth="1.5" strokeDasharray="5 4" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <path d={gapPath(pts('medianHours'))} fill="none" stroke={INFO} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </>
      }
      overlay={
        <>
          {weeks.map((w, i) => (hasVal(w, 'medianHours')
            ? <Dot key={`${uid}${w.week}`} x={pctX(i)} y={yOf(w.medianHours as number)} color={INFO} title={`Week of ${dmLabel(w.week)}${partialTag(weeks, i, asOf)}: median ${formatHours(w.medianHours)}, mean ${formatHours(w.meanHours)}, ${bugs(w.resolved)} resolved`} />
            : null))}
          {ends.map((e, i) => (
            <span key={e.text} aria-hidden="true" className="tnum cx-ends" style={{ position: 'absolute', left: '100%', marginLeft: 8, top: endY[i], transform: 'translateY(-50%)', fontSize: 12, lineHeight: '14px', fontWeight: 600, color: e.color, whiteSpace: 'nowrap' }}>{e.text}</span>
          ))}
        </>
      }
      legend={
        <>
          <LegendItem swatch={<svg width="14" height="12" aria-hidden="true" focusable="false"><rect x="0.5" y="0.5" width="13" height="11" rx="2" fill={NEUTRAL} fillOpacity="0.28" stroke={NEUTRAL} strokeOpacity="0.55" /></svg>}>bugs resolved <span style={{ color: MUTED }}>(bars, peak {countMax})</span></LegendItem>
          <LegendItem swatch={<LineSwatch color={INFO} />}>median</LegendItem>
          <LegendItem swatch={<LineSwatch color={MUTED} dashed thin />}>mean <span style={{ color: MUTED }}>(dashed; above the median means a few slow bugs)</span></LegendItem>
        </>
      }
      table={<HiddenTable caption="Time to resolve per week" head={['Week of', 'Bugs resolved', 'Median', 'Mean']} rows={weeks.map((w, i) => [`${w.week}${partialTag(weeks, i, asOf)}`, w.resolved, formatHours(w.medianHours), formatHours(w.meanHours)])} />}
    />
  );
}

// ---- (3) TtrByPriority -----------------------------------------------------------------------------
function priorityTone(p: string): { tone: Tone; tag: string } {
  const k = p.trim().toLowerCase();
  if (k === 'highest' || k === 'high' || k === 'blocker' || k === 'critical' || k === 'major') return { tone: 'bad', tag: 'urgent' };
  if (k === 'medium') return { tone: 'warn', tag: 'normal' };
  if (k === 'low' || k === 'lowest' || k === 'minor' || k === 'trivial') return { tone: 'info', tag: 'minor' };
  return { tone: 'neutral', tag: 'unset' };
}

export function TtrByPriority({ data }: { data: TtrPriorityRow[] }) {
  const total = data.reduce((a, d) => a + d.count, 0);
  if (data.length === 0 || total === 0) return <Empty>No resolved bugs to break down by priority.</Empty>;
  const max = Math.max(1e-6, ...data.map(d => Math.max(d.medianHours ?? 0, d.meanHours ?? 0)));
  const label = `Median time to resolve by priority: ${data.map(d => `${d.priority} ${d.medianHours == null ? 'no data' : `median ${formatHours(d.medianHours)}, mean ${formatHours(d.meanHours)}, ${bugs(d.count)}`}`).join('; ')}.`;
  return (
    <div>
      <div role="img" aria-label={label} style={{ display: 'grid', gap: 12 }}>
        {data.map(d => {
          const { tone, tag } = priorityTone(d.priority);
          const med = d.medianHours;
          const mean = d.meanHours;
          return (
            <div key={d.priority} aria-hidden="true" style={{ display: 'grid', gridTemplateColumns: 'minmax(64px, 96px) 1fr', alignItems: 'center', columnGap: 10, rowGap: 2 }}>
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontSize: 13, lineHeight: '16px', color: TEXT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.priority}</span>
                <span style={{ fontSize: 12, lineHeight: '14px', color: TONE_TEXT[tone] }}>{tag}</span>
              </span>
              <span style={{ position: 'relative', display: 'block', height: 12, borderRadius: 3, background: TONE_BG[tone], border: `1px solid ${TONE_BORDER[tone]}` }}>
                {med != null && <span title={`median ${formatHours(med)}`} style={{ display: 'block', height: '100%', width: `${Math.max(1, (med / max) * 100)}%`, background: TONE_FILL[tone], opacity: tone === 'neutral' ? 0.55 : 0.9, borderRadius: 2 }} />}
                {mean != null && <span title={`mean ${formatHours(mean)}`} style={{ position: 'absolute', top: -3, bottom: -3, left: `calc(${Math.min(100, (mean / max) * 100)}% - 1px)`, width: 2, background: TEXT, opacity: 0.45 }} />}
              </span>
              <span />
              <span className="mono tnum" style={{ fontSize: 12, lineHeight: '16px', color: MUTED, fontFamily: FONT_DATA, overflowWrap: 'anywhere' }}>
                {med == null ? `no resolved bugs` : `median ${formatHours(med)} · mean ${formatHours(mean)} · ${bugs(d.count)}`}
              </span>
            </div>
          );
        })}
        <div aria-hidden="true" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 13, lineHeight: '18px', color: TEXT }}>
          <LegendItem swatch={<svg width="22" height="10" aria-hidden="true" focusable="false"><rect width="22" height="10" rx="2" fill={NEUTRAL} fillOpacity="0.7" /></svg>}>bar = median</LegendItem>
          <LegendItem swatch={<svg width="6" height="14" aria-hidden="true" focusable="false"><rect x="2" width="2" height="14" fill={TEXT} fillOpacity="0.45" /></svg>}>faint tick = mean</LegendItem>
        </div>
      </div>
      <HiddenTable caption="Time to resolve by priority" head={['Priority', 'Bugs resolved', 'Median', 'Mean']} rows={data.map(d => [d.priority, d.count, formatHours(d.medianHours), formatHours(d.meanHours)])} />
    </div>
  );
}

// ---- (4) TtrDistribution ---------------------------------------------------------------------------
// Progressive warmth: quick = cool, slow = hot. The oldest bucket is also hatched; counts are always printed.
const DIST_STYLE: { fill: string; opacity: number }[] = [
  { fill: INFO, opacity: 0.85 },
  { fill: WARN, opacity: 0.5 },
  { fill: WARN, opacity: 0.8 },
  { fill: BAD, opacity: 0.7 },
  { fill: BAD, opacity: 0.95 },
];

export function TtrDistribution({ data }: { data: { bucket: string; count: number }[] }) {
  const total = data.reduce((a, d) => a + d.count, 0);
  if (data.length === 0 || total === 0) return <Empty>No resolved bugs to show a distribution for.</Empty>;
  const max = Math.max(1, ...data.map(d => d.count));
  const last = data.length - 1;
  const H = 84;
  const label = `Resolved bugs by time to resolve: ${data.map(d => `${d.bucket} ${d.count}`).join(', ')}.`;
  return (
    <div>
      <div role="img" aria-label={label} style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
        {data.map((d, i) => {
          const s = DIST_STYLE[Math.min(DIST_STYLE.length - 1, Math.round((i / Math.max(1, last)) * (DIST_STYLE.length - 1)))];
          const h = d.count === 0 ? 2 : Math.max(4, (d.count / max) * H);
          return (
            <div key={d.bucket} aria-hidden="true" title={`${d.bucket}: ${bugs(d.count)} (${pct(d.count / total)})`} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span className="mono tnum" style={{ fontSize: 13, lineHeight: '18px', fontWeight: 600, color: TEXT, fontFamily: FONT_DATA }}>{d.count}</span>
              <span style={{ width: '100%', maxWidth: 44, height: h, borderRadius: '3px 3px 0 0', background: s.fill, opacity: d.count === 0 ? 0.3 : s.opacity, backgroundImage: i === last && d.count > 0 ? 'repeating-linear-gradient(45deg, rgba(255,255,255,0.35) 0 2px, transparent 2px 6px)' : undefined }} />
              <span style={{ marginTop: 4, width: '100%', borderTop: `1px solid ${BORDER}`, paddingTop: 4, textAlign: 'center', fontSize: 12, lineHeight: '14px', color: MUTED, overflowWrap: 'anywhere' }}>{d.bucket}</span>
              <span className="tnum" style={{ fontSize: 12, lineHeight: '14px', color: FAINT }}>{pct(d.count / total)}</span>
            </div>
          );
        })}
      </div>
      <HiddenTable caption="Resolved bugs by time to resolve" head={['Time to resolve', 'Bugs', 'Share']} rows={data.map(d => [d.bucket, d.count, pct(d.count / total)])} />
    </div>
  );
}

// ---- (5) ReopenTrendChart --------------------------------------------------------------------------
const RO_LEFT = 32;
const RO_RIGHT = 46;

export function ReopenTrendChart({ weeks, asOf, height = 180 }: { weeks: ReopenWeek[]; asOf?: string; height?: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const n = weeks.length;
  const reopenedTotal = weeks.reduce((a, w) => a + w.reopened, 0);
  const resolvedTotal = weeks.reduce((a, w) => a + w.resolved, 0);
  if (n === 0 || reopenedTotal === 0) return <Empty>No bugs were reopened in this window.</Empty>;

  const H = height;
  const plotH = H - PT - PB;
  const slot = VB_W / n;
  const bw = Math.max(2, Math.min(28, slot * 0.6));
  const rateOf = (w: ReopenWeek): number | null => (w.resolved > 0 ? w.reopened / w.resolved : null);
  const rates = weeks.map(rateOf);
  const maxC = Math.max(2, Math.ceil(Math.max(...weeks.map(w => w.reopened)) / 2) * 2);
  const maxR = niceCeil(Math.max(0.05, ...rates.map(r => r ?? 0)));
  const yC = (v: number) => PT + (1 - v / maxC) * plotH;
  const yR = (r: number) => PT + (1 - r / maxR) * plotH;
  const px = (i: number) => (i + 0.5) * slot;
  const pctX = (i: number) => ((i + 0.5) / n) * 100;

  let lr = -1;
  for (let i = n - 1; i >= 0; i--) if (rates[i] != null) { lr = i; break; }
  const lastW = weeks[n - 1];
  const ends: { text: string; color: string; y: number }[] = [{ text: `reopened ${lastW.reopened}`, color: TONE_TEXT.warn, y: yC(lastW.reopened) }];
  if (lr >= 0) ends.push({ text: `${pct(rates[lr] as number)} per bug`, color: TONE_TEXT.info, y: yR(rates[lr] as number) });
  const endY = spreadLabels(ends.map(e => e.y), 7, H - 9);
  const overall = resolvedTotal > 0 ? ` (${resolvedTotal} bugs resolved in the same weeks)` : '';
  const label = `Reopened bugs per week, week of ${shortLabel(weeks[0].week)} to ${shortLabel(weeks[n - 1].week)}: ${reopenedTotal} reopen events${overall}. Bars are reopen events; the line is reopen events per bug resolved in that week, which can exceed 100%.`;
  const ratePts = weeks.map((w, i) => (rates[i] != null ? { x: px(i), y: yR(rates[i] as number) } : null));

  return (
    <WeekFrame
      n={n}
      dates={weeks.map(w => w.week)}
      height={H}
      left={RO_LEFT}
      right={RO_RIGHT}
      label={label}
      navLabel="Weekly reopened bugs chart. Use left and right arrow keys to inspect a week."
      readout={i => {
        const w = weeks[i];
        const r = rates[i];
        return `Week of ${dmLabel(w.week)}${partialTag(weeks, i, asOf)}: ${w.reopened} reopen events, ${w.resolved} bugs resolved${r != null ? ` (${pct(r)} events per bug resolved)` : ' (nothing resolved)'}`;
      }}
      leftTicks={[0, 0.5, 1].map(f => ({ y: yC(maxC * f), text: String(maxC * f) }))}
      rightTicks={[0, 0.5, 1].map(f => ({ y: yR(maxR * f), text: pct(maxR * f) }))}
      draw={
        <>
          <defs>
            <pattern id={`ro${uid}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill={WARN} fillOpacity="0.2" />
              <line x1="0" y1="0" x2="0" y2="6" stroke={WARN} strokeWidth="2.6" />
            </pattern>
          </defs>
          {weeks.map((w, i) => {
            if (w.reopened <= 0) return null;
            const y = yC(w.reopened);
            return (
              <rect key={w.week} x={px(i) - bw / 2} y={y} width={bw} height={H - PB - y} rx="1.5" fill={`url(#ro${uid})`} stroke={WARN} vectorEffect="non-scaling-stroke">
                <title>{`Week of ${dmLabel(w.week)}${partialTag(weeks, i, asOf)}: ${w.reopened} reopen events`}</title>
              </rect>
            );
          })}
          <path d={gapPath(ratePts)} fill="none" stroke={INFO} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </>
      }
      overlay={
        <>
          {weeks.map((w, i) => (rates[i] != null
            ? <Dot key={w.week} x={pctX(i)} y={yR(rates[i] as number)} color={INFO} title={`Week of ${dmLabel(w.week)}${partialTag(weeks, i, asOf)}: ${w.reopened} reopen events, ${w.resolved} bugs resolved (${pct(rates[i] as number)} events per bug resolved)`} />
            : null))}
          {ends.map((e, i) => (
            <span key={e.text} aria-hidden="true" className="tnum cx-ends" style={{ position: 'absolute', right: 0, top: endY[i], transform: 'translateY(-50%)', padding: '0 4px', borderRadius: 3, background: PANEL, fontSize: 12, lineHeight: '14px', fontWeight: 600, color: e.color, whiteSpace: 'nowrap', pointerEvents: 'none' }}>{e.text}</span>
          ))}
        </>
      }
      legend={
        <>
          <LegendItem swatch={<svg width="14" height="12" aria-hidden="true" focusable="false"><defs><pattern id={`rl${uid}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill={WARN} fillOpacity="0.2" /><line x1="0" y1="0" x2="0" y2="5" stroke={WARN} strokeWidth="2.2" /></pattern></defs><rect x="0.5" y="0.5" width="13" height="11" rx="2" fill={`url(#rl${uid})`} stroke={WARN} /></svg>}>reopen events <b className="tnum" style={{ fontFamily: FONT_DATA }}>{reopenedTotal}</b> <span style={{ color: MUTED }}>(bars, left axis: events per week)</span></LegendItem>
          <LegendItem swatch={<LineSwatch color={INFO} />}>reopen events per bug resolved <span style={{ color: MUTED }}>(line, right axis; can exceed 100%)</span></LegendItem>
        </>
      }
      table={<HiddenTable caption="Reopened bugs per week" head={['Week of', 'Reopen events', 'Bugs resolved', 'Events per bug resolved']} rows={weeks.map((w, i) => [`${w.week}${partialTag(weeks, i, asOf)}`, w.reopened, w.resolved, rates[i] == null ? '—' : pct(rates[i] as number)])} />}
    />
  );
}

// ---- (6) RateBadge ---------------------------------------------------------------------------------
const pillStyle = (tone: Tone): CSSProperties => ({
  display: 'inline-block', padding: '0 8px', borderRadius: 999, fontSize: 12, lineHeight: '20px', fontWeight: 600, whiteSpace: 'nowrap',
  color: TONE_TEXT[tone], background: TONE_BG[tone], border: `1px solid ${TONE_BORDER[tone]}`, fontFamily: FONT_DATA,
});

export function RateBadge({ rate, previous }: { rate: number | null; previous?: number | null }) {
  if (rate == null) return <span className="tnum" style={pillStyle('neutral')} title="Nothing was resolved in this window">— no data</span>;
  const tone: Tone = rate <= 0.05 ? 'ok' : rate <= 0.15 ? 'warn' : 'bad';
  const word = tone === 'ok' ? 'low' : tone === 'warn' ? 'moderate' : 'high';
  const pp = previous == null ? null : Math.round((rate - previous) * 100);
  const ppTone: Tone = pp == null || pp === 0 ? 'neutral' : pp > 0 ? 'bad' : 'ok';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
      <span className="tnum" style={pillStyle(tone)} title={`Reopen rate ${pct(rate)}: ${word}`}>{pct(rate)} {word}</span>
      {pp != null && (
        <span className="tnum" style={pillStyle(ppTone)} title={`${pp === 0 ? 'unchanged' : `${pp > 0 ? 'up' : 'down'} ${Math.abs(pp)} percentage points`} vs the previous period (${pct(previous as number)})`}>
          <span aria-hidden="true">{pp === 0 ? '— same' : `${pp > 0 ? '▲' : '▼'} ${Math.abs(pp)} pp`}</span>
          <span style={VISUALLY_HIDDEN}>{pp === 0 ? 'unchanged vs previous period' : `${pp > 0 ? 'up' : 'down'} ${Math.abs(pp)} percentage points vs previous period, ${pp > 0 ? 'worsening' : 'improving'}`}</span>
        </span>
      )}
    </span>
  );
}
