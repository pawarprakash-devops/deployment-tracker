'use client';
import { useMemo } from 'react';
import type { BadgeId, PipelineResponse, PipelineTicket } from '@/lib/pipeline-types';
import { useShell } from './ctx';
import { Card, Chip, Empty, ErrorNote, JiraNote, Pill, Skeleton, Tile, ago, type Tone } from './ui';

const BADGE: Record<BadgeId, { tone: Tone; label: string }> = {
  failed: { tone: 'bad', label: 'Failed' },
  rolled_back: { tone: 'warn', label: 'Rolled back' },
  hotfix: { tone: 'info', label: 'Hotfix' },
  stuck: { tone: 'warn', label: 'Stuck' },
};
const bareBtn: React.CSSProperties = { background: 'none', border: 0, padding: 0, textAlign: 'left' };
const DAY = 86_400_000;

function versionsOf(t: PipelineTicket): string[] {
  const envs = Object.values(t.environments).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  const v = envs[0]?.versions;
  if (!v) return [];
  return [v.single && (/^v/i.test(v.single) ? v.single : `v${v.single}`), v.frontend && `FE ${v.frontend}`, v.backend && `BE ${v.backend}`].filter(Boolean) as string[];
}

function Row({ t, p, open }: { t: PipelineTicket; p: PipelineResponse; open: (k: string) => void }) {
  const colName = p.columns.find((c) => c.id === t.column)?.name ?? t.column;
  const vs = versionsOf(t);
  return (
    <tr className="click" onClick={() => open(t.key)}>
      <td>
        <button type="button" className="key" style={bareBtn} onClick={(e) => { e.stopPropagation(); open(t.key); }}>
          {t.key}
        </button>
      </td>
      <td>
        {t.summary ?? (vs.length ? vs.map((v) => <Chip key={v}>{v}</Chip>) : <span className="muted">No version info</span>)}
      </td>
      <td>{colName}</td>
      <td className="muted">{ago(t.latestAt)}</td>
      <td>
        {t.badges.length === 0 ? <span className="muted">—</span> : t.badges.map((b) => (
          <Pill key={b.id} tone={BADGE[b.id].tone}>{BADGE[b.id].label}{b.days ? ` ${b.days}d` : ''}</Pill>
        ))}
      </td>
    </tr>
  );
}

function Table({ rows, p, open }: { rows: PipelineTicket[]; p: PipelineResponse; open: (k: string) => void }) {
  return (
    <table>
      <thead><tr><th>Ticket</th><th>Summary / versions</th><th>Furthest env</th><th>Age</th><th>Badges</th></tr></thead>
      <tbody>{rows.map((t) => <Row key={t.key} t={t} p={p} open={open} />)}</tbody>
    </table>
  );
}

export default function DevLens() {
  const { pipeline: p, error, setOpenTicket } = useShell();

  const d = useMemo(() => {
    if (!p) return null;
    const has = (t: PipelineTicket, ...ids: BadgeId[]) => t.badges.some((b) => ids.includes(b.id));
    const now = Date.now();
    const sorted = [...p.tickets].sort((a, b) => b.latestAt.localeCompare(a.latestAt));
    return {
      sorted,
      week: sorted.filter((t) => now - new Date(t.latestAt).getTime() <= 7 * DAY).length,
      failed: sorted.filter((t) => has(t, 'failed', 'rolled_back') || Object.values(t.environments).some((e) => e.state === 'failed' || e.state === 'rolled_back')).length,
      hotfix: sorted.filter((t) => has(t, 'hotfix')).length,
      waiting: sorted.filter((t) => Object.values(t.environments).some((e) => e.state === 'in_progress')).length,
      queued: sorted.filter((t) => Object.values(t.environments).some((e) => e.state === 'queued')).length,
      attention: sorted.filter((t) => has(t, 'failed', 'rolled_back', 'hotfix', 'stuck')),
    };
  }, [p]);

  return (
    <>
      <div className="page-h">
        <h1>Recent work</h1>
        <p>Without Jira there is no &ldquo;me&rdquo;, so this shows everyone&rsquo;s recent tickets. &ldquo;My tickets&rdquo; filtering arrives with sign-in.</p>
      </div>
      {error && <ErrorNote>Could not load the pipeline: {error}</ErrorNote>}
      {p && !p.jiraAuthorised && <JiraNote configured={p.configured} />}
      {!p || !d ? (!error && <Skeleton rows={5} />) : (
        <>
          <div className="grid g4">
            <Tile label="Tickets, last 7 days" value={d.week} />
            <Tile label="Failed or rolled back" value={d.failed} tone={d.failed ? 'bad' : undefined} />
            <Tile label="Hotfix tickets" value={d.hotfix} tone={d.hotfix ? 'info' : undefined} />
            <Tile label="Deployments waiting" value={d.waiting} hint={d.queued ? `in progress now; ${d.queued} more queued behind a running deploy` : 'in progress now'} />
          </div>
          <div className="stack">
            <Card title="Recently deployed tickets">
              {d.sorted.length ? <Table rows={d.sorted.slice(0, 15)} p={p} open={setOpenTicket} /> : <Empty>No tickets in the current window.</Empty>}
            </Card>
            <Card title="Needs attention">
              {d.attention.length ? <Table rows={d.attention.slice(0, 15)} p={p} open={setOpenTicket} /> : <Empty>Nothing needs attention.</Empty>}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
