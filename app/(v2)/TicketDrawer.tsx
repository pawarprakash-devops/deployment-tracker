'use client';
import { useEffect, useRef } from 'react';
import type { ColumnId, PipelineTicket } from '@/lib/pipeline-types';
import { useShell } from './ctx';
import { Chip, Pill, StatusPill, ago } from './ui';

const STEPS: { id: ColumnId; label: string }[] = [
  { id: 'preview', label: 'Preview' },
  { id: 'qa', label: 'QA' },
  { id: 'stage', label: 'Stage' },
  { id: 'preprod', label: 'Pre-Prod' },
  { id: 'prod-ankura', label: 'Prod' },
];

const BADGE_LABEL: Record<string, string> = { hotfix: 'Hotfix', failed: 'Failed', rolled_back: 'Rolled back' };

function stepState(t: PipelineTicket, id: ColumnId): 'done' | 'now' | 'bad' | '' {
  const reachedProd = t.reached.some((c) => c === 'prod-ankura' || c === 'prod-neotia');
  if (id === 'prod-ankura' && reachedProd) return t.column.startsWith('prod') ? 'now' : 'done';
  if (t.column === id) return 'now';
  if (t.reached.includes(id)) return 'done';
  return '';
}

export default function TicketDrawer() {
  const { openTicket, setOpenTicket, pipeline } = useShell();
  const closeRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!openTicket) return;
    opener.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpenTicket(null); return; }
      if (e.key !== 'Tab' || !panelRef.current) return;
      // keep keyboard focus inside the dialog
      const f = panelRef.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!panelRef.current.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); opener.current?.focus?.(); };
  }, [openTicket, setOpenTicket]);

  if (!openTicket) return null;
  const t = pipeline?.tickets.find((x) => x.key === openTicket);

  return (
    <>
      <div className="scrim" onClick={() => setOpenTicket(null)} aria-hidden="true" />
      <aside ref={panelRef} className="drawer" role="dialog" aria-modal="true" aria-label={`Ticket ${openTicket}`}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {t?.url ? <a className="key" href={t.url} target="_blank" rel="noreferrer" style={{ fontSize: 'var(--fs-md)' }}>{openTicket} ↗</a> : <span className="key" style={{ fontSize: 'var(--fs-md)' }}>{openTicket}</span>}
          <button ref={closeRef} className="icon-btn" onClick={() => setOpenTicket(null)} aria-label="Close ticket details">✕</button>
        </div>
        {!pipeline ? (
          <p className="empty" aria-busy="true">Loading…</p>
        ) : !t ? (
          <p className="empty">This ticket is not in the last {pipeline.window.deployments} deployments.</p>
        ) : (
          <>
            <h2 style={{ fontSize: 'var(--fs-lg)', margin: '12px 0 8px' }}>{t.summary ?? 'Title unavailable (Jira not connected)'}</h2>
            <p style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {t.status && <Pill tone="info">{t.status}</Pill>}
              {t.badges.map((b) => <Pill key={b.id} tone={b.id === 'hotfix' || b.id === 'failed' ? 'bad' : 'warn'}>{b.id === 'stuck' ? `Stuck ${b.days}d` : BADGE_LABEL[b.id] ?? b.id}</Pill>)}
              {t.assignee && <span className="muted">{t.assignee}</span>}
            </p>

            <h3 className="muted" style={{ fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 18 }}>Journey</h3>
            <div className="stepper">
              {STEPS.map((s) => <div key={s.id} className={`step ${stepState(t, s.id)}`}><i />{s.label}</div>)}
            </div>

            <h3 className="muted" style={{ fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Deployments</h3>
            <table>
              <tbody>
                {Object.entries(t.environments).map(([env, e]) => (
                  <tr key={env}>
                    <td>{env}</td>
                    <td><StatusPill status={e.state === 'deployed' ? 'Success' : e.state === 'in_progress' ? 'In Progress' : e.state === 'queued' ? 'Queued' : e.state === 'rolled_back' ? 'Rolled Back' : 'Failed'} /></td>
                    <td className="tnum">{e.versions.frontend && <Chip>FE {e.versions.frontend}</Chip>} {e.versions.backend && <Chip>BE {e.versions.backend}</Chip>} {!e.versions.frontend && !e.versions.backend && e.versions.single && <Chip>{e.versions.single}</Chip>}</td>
                    <td className="muted">{ago(e.lastAt)}</td>
                    <td>{e.runUrl && <a href={e.runUrl} target="_blank" rel="noreferrer" className="key">run ↗</a>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </aside>
    </>
  );
}
