'use client';
import { useMemo, useState } from 'react';
import type { PipelineColumn, PipelineEnvEntry, PipelineTicket } from '@/lib/pipeline-types';
import { useShell } from './ctx';
import { Chip, Empty, EnvDot, ErrorNote, JiraNote, Pill, Skeleton, ago, type Tone } from './ui';

const STATUS_TONE: [RegExp, Tone][] = [[/success/, 'ok'], [/fail/, 'bad'], [/progress/, 'info']];

function colTone(status: string | undefined): Tone {
  const s = (status ?? '').toLowerCase();
  return STATUS_TONE.find(([re]) => re.test(s))?.[1] ?? 'neutral';
}

function entryFor(t: PipelineTicket, col: PipelineColumn): PipelineEnvEntry | undefined {
  const env = col.environments.find((e) => t.environments[e]);
  return env ? t.environments[env] : undefined;
}

function versionLabel(e: PipelineEnvEntry | undefined): string {
  if (!e) return '';
  const { frontend, backend, single } = e.versions;
  if (single) return single;
  return [backend && `BE ${backend}`, frontend && `FE ${frontend}`].filter(Boolean).join(' ');
}

const BADGE_TEXT = { hotfix: 'Hotfix', failed: 'Failed', rolled_back: 'Rolled back', stuck: 'Stuck' } as const;

function Card({ t, col, onOpen }: { t: PipelineTicket; col: PipelineColumn; onOpen: (k: string) => void }) {
  const e = entryFor(t, col);
  const v = e?.versions;
  return (
    <button type="button" className="tk" onClick={() => onOpen(t.key)}>
      <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="key">{t.key}</span>
        {t.badges.map((b) => (
          <Pill key={b.id} tone={b.id === 'hotfix' || b.id === 'failed' ? 'bad' : 'warn'}>
            {BADGE_TEXT[b.id]}{b.days != null ? ` ${b.days}d` : ''}
          </Pill>
        ))}
      </span>
      <span className="t" style={{ display: 'block' }}>{t.summary || versionLabel(e) || t.key}</span>
      <span className="m" style={{ display: 'flex' }}>
        {v?.single && !v.frontend && !v.backend && <Chip>{v.single}</Chip>}
        {v?.frontend && <Chip title="Frontend">FE {v.frontend}</Chip>}
        {v?.backend && <Chip title="Backend">BE {v.backend}</Chip>}
        <span className="muted tnum">{t.ageInStageDays}d</span>
        {t.assignee && <span className="muted">{t.assignee}</span>}
      </span>
    </button>
  );
}

export default function PipelineTab() {
  const { pipeline, error, setOpenTicket } = useShell();
  const [q, setQ] = useState('');
  const [hotfix, setHotfix] = useState(false);
  const [problems, setProblems] = useState(false);

  const byCol = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const map = new Map<string, PipelineTicket[]>();
    for (const c of pipeline?.columns ?? []) map.set(c.id, []);
    for (const t of pipeline?.tickets ?? []) {
      const col = pipeline?.columns.find((c) => c.id === t.column);
      if (!col) continue;
      if (hotfix && !t.badges.some((b) => b.id === 'hotfix')) continue;
      if (problems && !t.badges.some((b) => b.id !== 'hotfix')) continue;
      if (needle && !`${t.key} ${t.summary ?? ''} ${versionLabel(entryFor(t, col))}`.toLowerCase().includes(needle)) continue;
      map.get(col.id)?.push(t);
    }
    return map;
  }, [pipeline, q, hotfix, problems]);

  return (
    <>
      <div className="page-h">
        <h1>Pipeline</h1>
        <p className="muted">Tickets by furthest environment · click a card for its journey</p>
      </div>
      {error && !pipeline && <ErrorNote>Could not load the pipeline: {error}</ErrorNote>}
      {!pipeline && !error && <Skeleton rows={5} />}
      {pipeline && (
        <>
          {!pipeline.jiraAuthorised && <JiraNote configured={pipeline.configured} />}
          <div className="row" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
            <input type="search" aria-label="Filter tickets" placeholder="Filter by key, title or version" value={q} onChange={(e) => setQ(e.target.value)} />
            <button type="button" className="btn" aria-pressed={hotfix} onClick={() => setHotfix((x) => !x)}>Hotfix only</button>
            <button type="button" className="btn" aria-pressed={problems} onClick={() => setProblems((x) => !x)}>Problems only</button>
          </div>
          <div className="board">
            {pipeline.columns.map((c) => {
              const items = byCol.get(c.id) ?? [];
              const status = c.health.latest?.status;
              return (
                <section key={c.id} className="col" aria-label={c.name}>
                  <h3>
                    <EnvDot tone={colTone(status)} label={`${c.name}: ${status ?? 'no deployments'}`} /> {c.name} <small>{c.ticketCount}</small>
                    {c.activeDeploy && <Pill tone="info">In progress</Pill>}
                  </h3>
                  <div className="muted">last success {ago(c.health.lastSuccessAt)}</div>
                  {items.length === 0 ? <Empty>Nothing here</Empty> : items.map((t) => <Card key={t.key} t={t} col={c} onOpen={setOpenTicket} />)}
                </section>
              );
            })}
          </div>
          <p className="muted">
            {pipeline.unlinked.deployments} deployments in the window have no Jira key. Showing the last {pipeline.window.deployments} deployments
            {pipeline.window.oldest ? ` back to ${new Date(pipeline.window.oldest).toLocaleDateString()}` : ''}.
          </p>
        </>
      )}
    </>
  );
}
