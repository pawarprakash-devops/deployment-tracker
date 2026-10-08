'use client';
import { useEffect, useState } from 'react';
import { useShell } from './ctx';
import { Card, Empty, EnvDot, Pill, Skeleton, Tile, ErrorNote, ago, type Tone } from './ui';

interface DriftPair {
  from: string; to: string; fromEnv: string; toEnv: string;
  pending?: number; status?: string; error?: string;
}

const BADGE_TONE: Record<string, Tone> = { failed: 'bad', rolled_back: 'warn', hotfix: 'info', stuck: 'warn' };
const BADGE_LABEL: Record<string, string> = { failed: 'Failed', rolled_back: 'Rolled back', hotfix: 'Hotfix', stuck: 'Stuck' };

function statusTone(s: string | undefined): Tone {
  const v = (s || '').toLowerCase();
  if (/(^|\s)success$/.test(v)) return 'ok';
  if (/fail/.test(v)) return 'bad';
  if (/progress/.test(v)) return 'info';
  if (/roll|cancel/.test(v)) return 'warn';
  return 'neutral';
}

export default function RelLens() {
  const { pipeline, error, setOpenTicket } = useShell();
  const [drift, setDrift] = useState<DriftPair[] | null>(null);
  const [driftErr, setDriftErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/drift?repo=backend');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (!Array.isArray(j?.pairs)) throw new Error('Unexpected response');
        if (alive) setDrift(j.pairs as DriftPair[]);
      } catch (e) {
        if (alive) setDriftErr(e instanceof Error ? e.message : 'Failed to load');
      }
    })();
    return () => { alive = false; };
  }, []);

  const heading = (
    <div className="page-h"><h1>Pipeline health</h1><p>Environments, failures and promotions for release owners</p></div>
  );
  if (error && !pipeline) return <>{heading}<ErrorNote>Could not load pipeline: {error}</ErrorNote></>;
  if (!pipeline) return <>{heading}<Card><Skeleton rows={5} /></Card></>;

  const cols = pipeline.columns;
  const healthy = cols.filter((c) => statusTone(c.health.latest?.status) === 'ok' && !c.activeDeploy).length;
  const inProg = cols.filter((c) => c.activeDeploy).length;
  const problems = cols.filter((c) => statusTone(c.health.latest?.status) === 'bad' || c.activeDeploy);
  const hasFailed = problems.some((c) => statusTone(c.health.latest?.status) === 'bad');
  const attention = pipeline.tickets.filter((t) => t.badges.some((b) => b.id in BADGE_LABEL));
  const failedTickets = pipeline.tickets.filter((t) => t.badges.some((b) => b.id === 'failed' || b.id === 'rolled_back')).length;

  return (
    <>
      {heading}
      {problems.length > 0 && (
        <div className="banner" role="alert" style={hasFailed ? { background: 'var(--bad-bg)', color: 'var(--bad-text)', borderColor: 'var(--bad-border)' } : undefined}>
          <strong>{hasFailed ? '✕ Attention: ' : '! Heads up: '}</strong>
          {problems.map((c, i) => {
            const failed = statusTone(c.health.latest?.status) === 'bad';
            return (
              <span key={c.id}>{i > 0 && '; '}{c.name} {failed ? `latest deploy failed (${ago(c.health.latest?.at)})` : 'deploy in progress'}{failed && c.activeDeploy ? ', redeploy in progress' : ''}</span>
            );
          })}
        </div>
      )}
      <div className="grid g4">
        <Tile label="Environments healthy" value={`${healthy} / ${cols.length}`} tone={healthy === cols.length ? 'ok' : 'warn'} hint="latest deploy succeeded, none running" />
        <Tile label="Deploys in progress" value={inProg} tone={inProg ? 'info' : undefined} />
        <Tile label="Tickets failed / rolled back" value={failedTickets} tone={failedTickets ? 'bad' : 'ok'} />
        <Tile label="Unlinked deployments" value={pipeline.unlinked.deployments} hint="no Jira key in notes/branch" />
      </div>
      <div className="stack">
        <Card title="Environments">
          {cols.length === 0 ? <Empty>No environments found.</Empty> : (
            <table>
              <thead><tr><th scope="col">Environment</th><th scope="col">Health</th><th scope="col">Last success</th><th scope="col">Tickets</th><th scope="col">Activity</th></tr></thead>
              <tbody>
                {cols.map((c) => {
                  const st = c.health.latest?.status;
                  const tone = statusTone(st);
                  return (
                    <tr key={c.id}>
                      <td><EnvDot tone={tone} label={`${c.name}: ${st ?? 'no deploys'}`} /> {c.name}</td>
                      <td>{st ? <Pill tone={tone}>{st}</Pill> : <span className="muted">no deploys</span>}</td>
                      <td className="muted">{ago(c.health.lastSuccessAt)}</td>
                      <td className="tnum">{c.ticketCount}</td>
                      <td>{c.activeDeploy ? <Pill tone="info">In progress</Pill> : <span className="muted">idle</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
        <div className="grid g2">
          <Card title="Needs attention">
            {attention.length === 0 ? <Empty>Nothing needs attention.</Empty> : (
              <table>
                <thead><tr><th scope="col">Ticket</th><th scope="col">Flags</th><th scope="col">Stage</th></tr></thead>
                <tbody>
                  {attention.map((t) => (
                    <tr key={t.key} className="click" onClick={() => setOpenTicket(t.key)}>
                      <td>
                        <button type="button" style={{ all: 'unset', cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); setOpenTicket(t.key); }}>
                          <span className="key">{t.key}</span>
                        </button>
                        {t.summary && <span className="muted"> {t.summary}</span>}
                      </td>
                      <td>{t.badges.filter((b) => b.id in BADGE_LABEL).map((b) => (
                        <Pill key={b.id} tone={BADGE_TONE[b.id]}>{BADGE_LABEL[b.id]}{b.days ? ` ${b.days}d` : ''}</Pill>
                      ))}</td>
                      <td className="muted">{cols.find((c) => c.id === t.column)?.name ?? t.column}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card title="Promotion radar">
            {driftErr ? <Empty>Promotion drift is unavailable ({driftErr}).</Empty>
              : !drift ? <Skeleton rows={3} />
              : drift.length === 0 ? <Empty>No promotion pairs reported.</Empty> : (
                <table>
                  <thead><tr><th scope="col">Promotion</th><th scope="col">Commits pending</th></tr></thead>
                  <tbody>
                    {drift.map((p) => (
                      <tr key={`${p.from}-${p.to}`}>
                        <td>{p.fromEnv} → {p.toEnv}</td>
                        <td className="tnum">{p.error ? <span className="muted">unavailable ({p.error})</span> : <Pill tone={p.pending ? 'warn' : 'ok'}>{p.pending ?? 0}</Pill>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </Card>
        </div>
      </div>
    </>
  );
}
