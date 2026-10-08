'use client';
import { useMemo, useState } from 'react';
import type { BugRow } from '@/lib/tickets-types';
import { Chip, Empty, ErrorNote, Pill, Skeleton, fmtDate, fmtDateTime, useNow } from '../ui';
import type { Tone } from '../ui';

type SortKey = 'newest' | 'priority' | 'oldest-open';
const STEP = 12;
const MAX = 50;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const UNASSIGNED = '__unassigned__';
const NO_PRIORITY = 'No priority';

// Lower rank = more urgent. Unknown names sort after the standard scale.
function rank(p: string | null): number {
  const n = (p || '').toLowerCase();
  if (/blocker|highest|critical|p0|urgent/.test(n)) return 0;
  if (/high|major|p1/.test(n)) return 1;
  if (/medium|normal|p2/.test(n)) return 2;
  if (/lowest|trivial|p4/.test(n)) return 4;
  if (/low|minor|p3/.test(n)) return 3;
  return 5;
}
const PRIORITY_UI: { tone: Tone; glyph: string }[] = [
  { tone: 'bad', glyph: '▲▲' }, { tone: 'warn', glyph: '▲' }, { tone: 'info', glyph: '■' },
  { tone: 'neutral', glyph: '▼' }, { tone: 'neutral', glyph: '▼▼' }, { tone: 'neutral', glyph: '–' },
];

function agoFrom(iso: string, now: number | null): string {
  if (now == null) return fmtDate(iso);
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const SR_ONLY = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap' } as const;
const selectStyle = { fontSize: 'var(--fs-sm)', minHeight: 34, border: '1px solid var(--border-bright)', background: 'var(--panel)', color: 'var(--text)', borderRadius: 'var(--r-sm)', padding: '4px 8px', maxWidth: '100%' } as const;
const CSS = `
.rb-bar{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:flex-end;margin:10px 0 6px}
.rb-f{display:flex;flex-direction:column;gap:2px;font-size:12px;color:var(--muted)}
.rb-list{list-style:none;margin:0;padding:0}
.rb-row{padding:9px 2px;border-top:1px solid var(--border)}
.rb-row:first-child{border-top:0}
.rb-l1{display:flex;align-items:baseline;gap:8px;min-width:0}
.rb-sum{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rb-l2{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;margin-top:4px;font-size:13px;color:var(--muted)}
.rb-key{text-decoration:none}.rb-key:hover{text-decoration:underline}
.rb-key:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px;border-radius:var(--r-xs)}
@media (max-width:640px){.rb-sum{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}.rb-l1{flex-wrap:wrap}}
`;

export default function RecentBugs({ bugs, loading, error, onRetry, days }: { bugs: BugRow[] | null; loading?: boolean; error?: string | null; onRetry?: () => void; days: number }) {
  const now = useNow(60_000);
  const [priority, setPriority] = useState('');
  const [status, setStatus] = useState('');
  const [assignee, setAssignee] = useState('');
  const [openOnly, setOpenOnly] = useState(true);
  const [sort, setSort] = useState<SortKey>('newest');
  const [shown, setShown] = useState(STEP);

  const list = useMemo(() => (bugs ?? []).slice(0, MAX), [bugs]);
  const opts = useMemo(() => {
    const pr = [...new Set(list.map((b) => b.priority || NO_PRIORITY))].sort((a, b) => rank(a === NO_PRIORITY ? null : a) - rank(b === NO_PRIORITY ? null : b));
    const st = [...new Set(list.map((b) => b.status))].sort();
    const as = [...new Set(list.map((b) => b.assignee).filter((x): x is string => !!x))].sort();
    return { pr, st, as, hasUnassigned: list.some((b) => !b.assignee) };
  }, [list]);

  const rows = useMemo(() => {
    const t = (b: BugRow) => new Date(b.created).getTime();
    const f = list.filter((b) =>
      (!openOnly || !b.resolved) &&
      (!priority || (b.priority || NO_PRIORITY) === priority) &&
      (!status || b.status === status) &&
      (!assignee || (assignee === UNASSIGNED ? !b.assignee : b.assignee === assignee)));
    if (sort === 'priority') f.sort((a, b) => rank(a.priority) - rank(b.priority) || t(b) - t(a));
    else if (sort === 'oldest-open') f.sort((a, b) => (a.resolved ? 1 : 0) - (b.resolved ? 1 : 0) || t(a) - t(b));
    else f.sort((a, b) => t(b) - t(a));
    return f;
  }, [list, openOnly, priority, status, assignee, sort]);

  const clear = () => { setPriority(''); setStatus(''); setAssignee(''); setOpenOnly(false); setShown(STEP); };
  const reset = () => setShown(STEP);
  const meta = bugs ? `${bugs.length} raised in the last ${days} days` : null;

  let body: React.ReactNode;
  if (error) body = <ErrorNote onRetry={onRetry}>Could not load recent bugs. {error}</ErrorNote>;
  else if (loading || !bugs) body = <Skeleton variant="rows" rows={5} height={52} />;
  else if (bugs.length === 0) body = <Empty icon="✓" title="All clear">{`No bugs raised in the last ${days} days. Nice.`}</Empty>;
  else if (rows.length === 0) body = <Empty icon="○" title="No bugs match these filters" action={{ label: 'Clear filters', onClick: clear }}>Try a different priority, status or assignee, or include resolved bugs.</Empty>;
  else {
    const visible = rows.slice(0, shown);
    const next = Math.min(STEP, rows.length - visible.length);
    body = (
      <>
        <ul className="rb-list" aria-label="Recently raised bugs">
          {visible.map((b) => {
            const done = !!b.resolved;
            const pr = rank(b.priority);
            const ui = PRIORITY_UI[pr];
            const created = new Date(b.created).getTime();
            const isNew = now != null && now - created < DAY && now >= created;
            const stale = !done && b.ageDays > 7;
            return (
              <li key={b.key} className="rb-row">
                <div className="rb-l1">
                  <span style={{ flex: 'none' }}>
                    <Pill tone={ui.tone} icon={false}><span aria-hidden="true">{ui.glyph}</span>{b.priority || NO_PRIORITY}</Pill>
                  </span>
                  <a className="key rb-key" href={b.url} target="_blank" rel="noopener noreferrer" style={{ flex: 'none' }}>{b.key}<span style={SR_ONLY}> (opens in a new tab)</span></a>
                  {isNew && <span style={{ flex: 'none', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', color: 'var(--info-text)', background: 'var(--info-bg)', border: '1px solid var(--info-border)', borderRadius: 4, padding: '0 5px' }}>NEW</span>}
                  <span className="rb-sum" title={b.summary}>{b.summary}</span>
                </div>
                <div className="rb-l2">
                  <Pill tone={done ? 'ok' : 'neutral'} icon={false}>{b.stage}</Pill>
                  <span title={fmtDateTime(b.created)}>raised {agoFrom(b.created, now)}{b.reporter ? ` by ${b.reporter}` : ''}</span>
                  {b.assignee ? <span>{b.assignee}</span> : <span style={{ fontStyle: 'italic' }}>Unassigned</span>}
                  <span className="tnum" style={stale ? { color: 'var(--warn-text)', fontWeight: 600 } : undefined}>
                    {stale && <span aria-hidden="true">! </span>}{done ? `fixed in ${b.ageDays}d` : `${b.ageDays}d open`}
                  </span>
                  {[...b.components, ...b.labels].slice(0, 2).map((c) => <Chip key={c}>{c}</Chip>)}
                </div>
              </li>
            );
          })}
        </ul>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
          {next > 0 && <button type="button" className="btn" onClick={() => setShown((n) => n + STEP)}>Show {next} more</button>}
          <span className="muted" style={{ fontSize: 13 }} aria-live="polite">Showing {visible.length} of {rows.length}</span>
        </div>
      </>
    );
  }

  return (
    <section className="panel-quiet fade-in" aria-label="Recently raised bugs">
      <style>{CSS}</style>
      <div className="section-h" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--fs-md)' }}>Recently raised bugs</h2>
        {meta && <span className="muted" style={{ fontSize: 13 }}>{meta}</span>}
      </div>
      {bugs && bugs.length > 0 && !error && (
        <div className="rb-bar" role="group" aria-label="Filter and sort bugs">
          <label className="rb-f">Priority
            <select style={selectStyle} value={priority} onChange={(e) => { setPriority(e.target.value); reset(); }}>
              <option value="">All priorities</option>
              {opts.pr.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
          <label className="rb-f">Status
            <select style={selectStyle} value={status} onChange={(e) => { setStatus(e.target.value); reset(); }}>
              <option value="">All statuses</option>
              {opts.st.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
          <label className="rb-f">Assignee
            <select style={selectStyle} value={assignee} onChange={(e) => { setAssignee(e.target.value); reset(); }}>
              <option value="">Everyone</option>
              {opts.hasUnassigned && <option value={UNASSIGNED}>Unassigned</option>}
              {opts.as.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
          <label className="rb-f">Sort by
            <select style={selectStyle} value={sort} onChange={(e) => { setSort(e.target.value as SortKey); reset(); }}>
              <option value="newest">Newest</option>
              <option value="priority">Highest priority</option>
              <option value="oldest-open">Oldest open</option>
            </select>
          </label>
          <button type="button" className="btn" aria-pressed={openOnly} onClick={() => { setOpenOnly((v) => !v); reset(); }}>Open only</button>
        </div>
      )}
      {body}
    </section>
  );
}
