'use client';
import { useEffect, useMemo, useState } from 'react';
import type { ColumnId, PipelineResponse, PipelineTicket } from '@/lib/pipeline-types';
import { useShell } from './ctx';
import { Card, Chip, Empty, ErrorNote, JiraNote, Pill, Skeleton, Tile, ago, type Tone } from './ui';

const QA_COLS: ColumnId[] = ['qa', 'demo'];
const LATER_COLS: ColumnId[] = ['stage', 'preprod', 'prod-ankura', 'prod-neotia'];
const WINDOWS = [{ label: '1:30 PM', min: 13 * 60 + 30 }, { label: '4:00 PM', min: 16 * 60 }];
const IST_OFFSET_MS = 330 * 60_000; // Asia/Kolkata is a fixed UTC+5:30 (no DST)
const bareBtn: React.CSSProperties = { background: 'none', border: 0, padding: 0, textAlign: 'left' };

function nextWindow(nowMs: number) {
  const ist = new Date(nowMs + IST_OFFSET_MS);
  const cur = ist.getUTCHours() * 60 + ist.getUTCMinutes() + ist.getUTCSeconds() / 60;
  const hit = WINDOWS.find((w) => w.min > cur);
  const w = hit ?? WINDOWS[0];
  const mins = Math.ceil((hit ? w.min : w.min + 1440) - cur);
  return { label: w.label, mins, tomorrow: !hit };
}
const fmt = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

// State of the ticket in its furthest column (most recent entry among that column's environments).
function stateIn(t: PipelineTicket, p: PipelineResponse) {
  const envs = p.columns.find((c) => c.id === t.column)?.environments ?? [];
  const e = Object.entries(t.environments).filter(([k]) => envs.includes(k)).map(([, v]) => v).sort((a, b) => b.lastAt.localeCompare(a.lastAt))[0];
  return e?.state ?? 'deployed';
}
const STATE: Record<string, { tone: Tone; label: string }> = {
  deployed: { tone: 'ok', label: 'Deployed' }, in_progress: { tone: 'info', label: 'In progress' }, queued: { tone: 'warn', label: 'Queued' },
  failed: { tone: 'bad', label: 'Failed' }, rolled_back: { tone: 'warn', label: 'Rolled back' },
};

function List({ rows, p, open, empty }: { rows: PipelineTicket[]; p: PipelineResponse; open: (k: string) => void; empty: string }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <table>
      <thead><tr><th>Ticket</th><th>Summary / branch</th><th>Env</th><th>State</th><th>Age</th></tr></thead>
      <tbody>
        {rows.slice(0, 15).map((t) => {
          const st = STATE[stateIn(t, p)];
          const v = Object.values(t.environments)[0]?.versions;
          const ver = v?.single ?? v?.backend ?? v?.frontend;
          return (
            <tr key={t.key} className="click" onClick={() => open(t.key)}>
              <td>
                <button type="button" className="key" style={bareBtn} onClick={(e) => { e.stopPropagation(); open(t.key); }}>{t.key}</button>
              </td>
              <td>
                {t.summary ?? <span className="muted">No Jira title</span>} {ver && <Chip>{ver}</Chip>}
                {t.stage && <> <Pill tone={t.stage === 'QA Passed' ? 'ok' : 'neutral'}>{t.stage}</Pill></>}
              </td>
              <td>{p.columns.find((c) => c.id === t.column)?.name ?? t.column}</td>
              <td><Pill tone={st.tone}>{st.label}</Pill></td>
              <td className="muted">{ago(t.latestAt)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function QaLens() {
  const { pipeline: p, error, setOpenTicket } = useShell();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clock starts after mount to avoid a hydration mismatch
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const d = useMemo(() => {
    if (!p) return null;
    const sorted = [...p.tickets].sort((a, b) => b.latestAt.localeCompare(a.latestAt));
    const passed = (t: PipelineTicket) => t.stage === 'QA Passed';
    const inQa = sorted.filter((t) => QA_COLS.includes(t.column));
    return {
      ready: inQa.filter((t) => !passed(t) && stateIn(t, p) === 'deployed'),
      queue: inQa.filter((t) => !passed(t)),
      later: sorted.filter((t) => LATER_COLS.includes(t.column) || (passed(t) && QA_COLS.includes(t.column))),
      laterCount: sorted.filter((t) => LATER_COLS.includes(t.column)).length,
      failedQa: inQa.filter((t) => ['failed', 'rolled_back'].includes(stateIn(t, p))).length,
    };
  }, [p]);
  const win = now === null ? null : nextWindow(now);

  return (
    <>
      <div className="page-h">
        <h1>QA queue</h1>
        <p>QA releases go out at 1:30 PM and 4:00 PM IST, or by manual dispatch. {win && <>Next window: <strong>{win.label} IST{win.tomorrow ? ' tomorrow' : ''}</strong> in {fmt(win.mins)}.</>}</p>
      </div>
      {error && <ErrorNote>Could not load the pipeline: {error}</ErrorNote>}
      {p && !p.jiraAuthorised && <JiraNote configured={p.configured} />}
      {!p || !d ? (!error && <Skeleton rows={5} />) : (
        <>
          <div className="grid g4">
            <Tile label="Ready to test" value={d.ready.length} tone={d.ready.length ? 'info' : undefined} hint="deployed to QA or Demo" />
            <Tile label="Deployed to Stage+" value={d.laterCount} />
            <Tile label="Failed in QA" value={d.failedQa} tone={d.failedQa ? 'bad' : undefined} />
            <Tile label="Next window" value={win ? fmt(win.mins) : '…'} hint={win ? `${win.label} IST${win.tomorrow ? ' tomorrow' : ''}` : undefined} />
          </div>
          <div className="stack">
            <Card title="Ready to test">
              <List rows={d.queue} p={p} open={setOpenTicket} empty="Nothing is waiting in QA or Demo." />
            </Card>
            <Card title="Recently moved past QA">
              <List rows={d.later} p={p} open={setOpenTicket} empty="No tickets have moved past QA recently." />
            </Card>
          </div>
        </>
      )}
    </>
  );
}
