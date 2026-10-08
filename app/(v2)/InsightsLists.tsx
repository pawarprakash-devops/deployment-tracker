'use client';
import type { CSSProperties } from 'react';
import { Card, Chip, Empty, Pill, ago, fmtDate, fmtDateTime, type Tone } from './ui';

// Element types mirror the arrays built in app/api/admin/stats/route.ts.
export interface FailureRecord {
  environment: string;
  branch: string | null;
  started_at: string;
  notes: string | null;
}

export interface SlowestRecord {
  environment: string;
  duration_seconds: number;
  started_at: string;
  branch: string | null;
}

export interface RecoveryIncident {
  environment: string;
  failedAt: string;
  recoveredAt: string;
  failedRunLink: string | null;
  recoveredRunLink: string | null;
  failedAuthor: string | null;
  recoveredAuthor: string | null;
  durationMinutes: number;
}

export interface ListsStats {
  recentFailures: FailureRecord[];
  slowestDeployments: SlowestRecord[];
  mostActiveUsers: Record<string, number>;
  dora: { recentRecoveries: RecoveryIncident[] };
}

const wrap: CSSProperties = { overflowWrap: 'anywhere', minWidth: 0 };
const listReset: CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' };
const itemBox: CSSProperties = {
  border: '1px solid var(--border)',
  background: 'var(--panel-2)',
  borderRadius: 'var(--r-sm)',
  padding: 'var(--space-2) var(--space-3)',
  ...wrap,
};
const headRow: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-2)' };
const small: CSSProperties = { fontSize: 'var(--fs-xs)', lineHeight: 'var(--lh-xs)', color: 'var(--muted)' };

function formatSeconds(seconds: number): string {
  if (!seconds) return '0s';
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return mins === 0 ? `${secs}s` : `${mins}m ${secs}s`;
}

function formatMttr(min: number): string {
  return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h ${min % 60}m`;
}

function mttrTone(min: number): Tone {
  return min <= 30 ? 'ok' : min <= 60 ? 'warn' : 'bad';
}

function stamp(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : fmtDateTime(d);
}

const th: CSSProperties = {
  textAlign: 'left', padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--fs-2xs)', lineHeight: 'var(--lh-2xs)',
  textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)', fontWeight: 600,
  borderBottom: '1px solid var(--border-bright)', whiteSpace: 'nowrap',
};
const td: CSSProperties = {
  padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--fs-sm)', lineHeight: 'var(--lh-sm)',
  borderBottom: '1px solid var(--border)', verticalAlign: 'top', overflowWrap: 'anywhere',
};

export default function InsightsLists({ stats }: { stats: ListsStats }) {
  const failures = stats.recentFailures ?? [];
  const slowest = stats.slowestDeployments ?? [];
  const recoveries = stats.dora?.recentRecoveries ?? [];
  const users = Object.entries(stats.mostActiveUsers ?? {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10);
  const maxCount = Math.max(1, ...users.map(([, n]) => n));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--space-4)', alignItems: 'start' }}>
        <Card title="Recent failures" action={<Chip>{failures.length}</Chip>}>
          {failures.length === 0 ? (
            <Empty>No failed deployments in recent runs.</Empty>
          ) : (
            <ul style={listReset}>
              {failures.map((d, i) => (
                <li key={`${d.environment}-${d.started_at}-${i}`} style={itemBox}>
                  <div style={headRow}>
                    <Pill tone="bad">FAIL</Pill>
                    <strong style={wrap}>{d.environment}</strong>
                    <span style={{ ...small, marginLeft: 'auto' }} title={stamp(d.started_at)}>{ago(d.started_at)}</span>
                  </div>
                  <div style={{ ...small, ...wrap, marginTop: 'var(--space-1)' }}>
                    <span className="tnum">git:{d.branch || '—'}</span>
                  </div>
                  {d.notes && (
                    <p
                      title={d.notes}
                      style={{
                        ...wrap, margin: 'var(--space-1) 0 0', fontSize: 'var(--fs-sm)', lineHeight: 'var(--lh-sm)',
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                      }}
                    >
                      {d.notes}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Longest runs" action={<Chip>{slowest.length}</Chip>}>
          {slowest.length === 0 ? (
            <Empty>No timed deployments yet.</Empty>
          ) : (
            <ol style={listReset}>
              {slowest.map((d, i) => (
                <li key={`${d.environment}-${d.started_at}-${i}`} style={itemBox}>
                  <div style={headRow}>
                    <span className="tnum" style={{ fontWeight: 700, fontSize: 'var(--fs-sm)' }}>
                      <span aria-hidden="true">⏱ </span>{formatSeconds(d.duration_seconds)}
                    </span>
                    <strong style={wrap}>{d.environment}</strong>
                    <span style={{ ...small, marginLeft: 'auto' }} title={stamp(d.started_at)}>{ago(d.started_at)}</span>
                  </div>
                  <div style={{ ...small, ...wrap, marginTop: 'var(--space-1)' }}>
                    <span className="tnum">git:{d.branch || '—'}</span>
                    <span> · {fmtDate(d.started_at)}</span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card title="Operator leaderboard" action={<Chip>top {users.length}</Chip>}>
          {users.length === 0 ? (
            <Empty>No operator activity recorded.</Empty>
          ) : (
            <ol style={listReset}>
              {users.map(([user, count], i) => (
                <li key={user} style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', gap: 'var(--space-2)', alignItems: 'center' }}>
                  <span className="tnum" style={{ ...small, minWidth: 28 }}>#{i + 1}</span>
                  <div style={wrap}>
                    <div style={{ fontSize: 'var(--fs-sm)', lineHeight: 'var(--lh-sm)', ...wrap }}>{user}</div>
                    <div
                      role="presentation"
                      style={{ height: 6, borderRadius: 999, background: 'var(--panel-3)', overflow: 'hidden', marginTop: 2 }}
                    >
                      <div style={{ width: `${Math.max(2, (count / maxCount) * 100)}%`, height: '100%', background: 'var(--accent)', borderRadius: 999 }} />
                    </div>
                  </div>
                  <span className="tnum" style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {count} {count === 1 ? 'run' : 'runs'}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <Card title="Recovery audit trail" action={<Chip>{recoveries.length} logged</Chip>}>
        <p className="subtle" style={{ margin: '0 0 var(--space-3)' }}>
          Failed pipeline runs resolved by a later successful release on the same environment.
        </p>
        {recoveries.length === 0 ? (
          <Empty>No recoveries recorded yet.</Empty>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th} scope="col">Environment</th>
                  <th style={th} scope="col">Failed at</th>
                  <th style={th} scope="col">Recovered at</th>
                  <th style={th} scope="col">MTTR</th>
                  <th style={th} scope="col">Recovered by</th>
                  <th style={th} scope="col">Runs</th>
                </tr>
              </thead>
              <tbody>
                {recoveries.map((inc, i) => (
                  <tr key={`${inc.environment}-${inc.failedAt}-${i}`}>
                    <td style={{ ...td, fontWeight: 600 }}>{inc.environment}</td>
                    <td style={td} className="tnum">{stamp(inc.failedAt)}</td>
                    <td style={td} className="tnum">{stamp(inc.recoveredAt)}</td>
                    <td style={td}>
                      <Pill tone={mttrTone(inc.durationMinutes)}>{formatMttr(inc.durationMinutes)}</Pill>
                    </td>
                    <td style={td}>{inc.recoveredAuthor || inc.failedAuthor || 'GitHub Actions'}</td>
                    <td style={td}>
                      <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
                        {inc.failedRunLink && (
                          <a href={inc.failedRunLink} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-text)', textDecoration: 'underline' }}>
                            Failed run ↗
                          </a>
                        )}
                        {inc.recoveredRunLink && (
                          <a href={inc.recoveredRunLink} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-text)', textDecoration: 'underline' }}>
                            Fix run ↗
                          </a>
                        )}
                        {!inc.failedRunLink && !inc.recoveredRunLink && <span className="muted">—</span>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
