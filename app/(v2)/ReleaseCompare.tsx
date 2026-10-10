'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Chip, Empty, ErrorNote, Pill, Skeleton, fmtDateTime } from './ui';

type Row = Record<string, string | number | null | undefined>;
type Repo = 'FE' | 'BE';
const REPOS: Record<Repo, { slug: string; label: string }> = {
  FE: { slug: 'vidaisolutions/vidai-react', label: 'Frontend' },
  BE: { slug: 'vidaisolutions/vidai-backend', label: 'Backend' },
};
const ENV_DEFAULT_BRANCH: Record<string, string> = {
  'Preview': 'dev', 'Demo-Preview': 'demo', 'QA': 'qa', 'Stage': 'stage', 'Stage EUW2': 'stage',
  'Pre-Prod': 'preprod', 'Pre-Prod (India)': 'preprod', 'Pre-Prod USW': 'preprod_usw',
  'Production (Ankura)': 'prod_ank', 'Production (Neotia)': 'prod_neo', 'Production (Neotia/Babyjoy)': 'prod_neo', 'Production USW': 'prod_usw', 'Production': 'prod_ank',
};
interface Commit { sha: string; short_sha: string; message: string; author: string; author_login?: string; date: string; url: string }
interface GhFile { filename: string; status: string; additions: number; deletions: number }
interface CompareData { status?: string; ahead_by?: number; behind_by?: number; total_commits?: number; commits?: Commit[]; files?: GhFile[]; files_changed?: number }
type Result = { kind: 'ok'; data: CompareData; base?: string; head: string; fallback: boolean } | { kind: 'none'; msg: string };

const FIELDS: [string, string][] = [
  ['environment', 'Environment'], ['status', 'Status'], ['deployment_type', 'Type'], ['branch', 'Branch'], ['version', 'Version'],
  ['frontend_branch', 'FE branch'], ['frontend_version', 'FE version'], ['backend_branch', 'BE branch'], ['backend_version', 'BE version'],
  ['requested_by', 'Requested by'], ['approved_by', 'Approved by'], ['tested_by', 'Tested by'], ['deployed_by', 'Deployed by'],
  ['started_at', 'Started'], ['approved_at', 'Approved at'], ['duration_seconds', 'Duration'],
];

const str = (v: unknown) => (v === null || v === undefined || v === '' ? '' : String(v));
function fmtDur(s: number): string {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
function cell(field: string, r: Row): string {
  const v = r[field];
  if (v === null || v === undefined || v === '') return '—';
  if (field === 'started_at' || field === 'approved_at') return fmtDateTime(String(v));
  if (field === 'duration_seconds') return fmtDur(Number(v));
  return String(v);
}
function refFor(r: Row, repo: Repo): string {
  const specific = repo === 'FE' ? r.frontend_branch : r.backend_branch;
  return str(specific) || str(r.branch) || ENV_DEFAULT_BRANCH[str(r.environment)] || '';
}
function defaultRepo(a: Row, b: Row): Repo {
  const be = [a, b].some(r => r.backend_branch || r.backend_version);
  return be ? 'BE' : 'FE';
}
const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

export default function ReleaseCompare() {
  const [pair, setPair] = useState<{ a: Row; b: Row } | null>(null);
  const [repo, setRepo] = useState<Repo>('BE');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setPair(null); setResult(null);
    const el = prevFocus.current;
    prevFocus.current = null;
    if (el && document.contains(el)) el.focus();
  }, []);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<{ a?: Row; b?: Row }>).detail;
      if (!d?.a || !d?.b) return;
      if (!prevFocus.current && document.activeElement instanceof HTMLElement) prevFocus.current = document.activeElement;
      setRepo(defaultRepo(d.a, d.b));
      setResult(null);
      setPair({ a: d.a, b: d.b });
    };
    window.addEventListener('tracker:compare', onOpen);
    return () => window.removeEventListener('tracker:compare', onOpen);
  }, []);

  // Fetch commit comparison whenever the pair or repo toggle changes.
  useEffect(() => {
    if (!pair) return;
    const ctl = new AbortController();
    const slug = REPOS[repo].slug;
    const base = refFor(pair.a, repo), head = refFor(pair.b, repo);
    const get = async (qs: string): Promise<CompareData | null> => {
      const r = await fetch(`/api/compare?repo=${encodeURIComponent(slug)}${qs}`, { signal: ctl.signal });
      if (!r.ok) return null;
      const j = (await r.json()) as CompareData & { error?: string };
      return j.error ? null : j;
    };
    (async () => {
      setLoading(true); setResult(null);
      try {
        let res: Result | null = null;
        if (head && base && base !== head) {
          const d = await get(`&base=${encodeURIComponent(base)}&head=${encodeURIComponent(head)}`);
          if (d) res = { kind: 'ok', data: d, base, head, fallback: false };
        }
        if (!res && head) {
          const d = await get(`&head=${encodeURIComponent(head)}`);
          if (d) res = { kind: 'ok', data: d, head, fallback: true };
        }
        setResult(res ?? { kind: 'none', msg: head ? 'Commit comparison needs GH_TOKEN or valid refs.' : 'No branch or ref recorded for these deployments.' });
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setResult({ kind: 'none', msg: 'Commit comparison needs GH_TOKEN or valid refs.' });
      } finally {
        if (!ctl.signal.aborted) setLoading(false);
      }
    })();
    return () => ctl.abort();
  }, [pair, repo]);

  // Focus management, Esc, Tab trap, body scroll lock.
  useEffect(() => {
    if (!pair) return;
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1], active = document.activeElement;
      if (!panelRef.current.contains(active)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; };
  }, [pair, close]);

  if (!pair) return null;
  const { a, b } = pair;
  const delta = Math.round((new Date(String(b.started_at)).getTime() - new Date(String(a.started_at)).getTime()) / 1000);
  const deltaText = Number.isFinite(delta)
    ? `b deployed ${fmtDur(Math.abs(delta))} ${delta >= 0 ? 'after' : 'before'} a`
    : 'Time difference unavailable';
  const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', color: 'var(--muted)', fontSize: 'var(--fs-xs)', fontWeight: 600 };
  const td: React.CSSProperties = { padding: '6px 8px', borderTop: '1px solid var(--border)', verticalAlign: 'top', overflowWrap: 'anywhere' };
  const h3: React.CSSProperties = { margin: '16px 0 8px', fontSize: 'var(--fs-sm)', color: 'var(--muted)' };
  const mono: React.CSSProperties = { fontFamily: 'var(--font-mono, ui-monospace, monospace)' };
  const ok = result?.kind === 'ok' ? result : null;
  const d = ok?.data;
  const fileBadge = (s: string) => (s === 'added' ? 'A' : s === 'removed' ? 'D' : s === 'renamed' ? 'R' : 'M');

  return (
    <>
      <div className="scrim" style={{ inset: 0, zIndex: 'calc(var(--z-drawer) + 1)' as string }} onClick={close} aria-hidden="true" />
      <div
        ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="rc-title"
        style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 'calc(var(--z-drawer) + 2)' as string,
          width: 'min(980px, calc(100vw - 24px))', maxHeight: 'calc(100vh - 24px)', overflow: 'auto',
          background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--r-md, 8px)',
          padding: 'var(--space-5)', boxShadow: 'var(--elev-2)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <h2 id="rc-title" style={{ margin: 0, fontSize: 'var(--fs-lg, 18px)' }}>Compare deployments</h2>
          <button ref={closeRef} type="button" className="btn" onClick={close} aria-label="Close compare dialog">Close</button>
        </div>
        <p style={{ margin: '8px 0 0', color: 'var(--accent-text)' }}>{deltaText}</p>

        <div style={{ overflowX: 'auto', marginTop: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)', tableLayout: 'fixed', minWidth: 520 }}>
            <thead><tr><th style={{ ...th, width: '22%' }}>Field</th><th style={th}>A (older)</th><th style={th}>B (newer)</th></tr></thead>
            <tbody>
              {FIELDS.map(([f, label]) => {
                const diff = str(a[f]) !== str(b[f]);
                const bg = diff ? 'var(--warn-bg)' : undefined;
                return (
                  <tr key={f}>
                    <td style={{ ...td, color: 'var(--muted)' }}>{label}</td>
                    <td style={{ ...td, background: bg }}>{cell(f, a)}</td>
                    <td style={{ ...td, background: bg }}>
                      {cell(f, b)}{diff && <> <span className="pill" style={{ color: 'var(--warn-text)', border: '1px solid var(--warn-border)', marginLeft: 6 }}>changed</span></>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 20 }}>
          <h3 style={{ margin: 0, fontSize: 'var(--fs-md, 15px)' }}>
            Code changes {ok?.base && <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 'var(--fs-sm)' }}>({ok.base} → {ok.head})</span>}
          </h3>
          <div role="group" aria-label="Repository" style={{ display: 'flex', gap: 8 }}>
            {(Object.keys(REPOS) as Repo[]).map(k => (
              <button key={k} type="button" className="btn" aria-pressed={repo === k} onClick={() => setRepo(k)}>{REPOS[k].label}</button>
            ))}
          </div>
        </div>

        <div aria-live="polite" style={{ marginTop: 8 }}>
          {loading && <Skeleton rows={4} />}
          {!loading && result?.kind === 'none' && (
            <>
              <ErrorNote>{result.msg}</ErrorNote>
              <Empty>No commit details to show for {REPOS[repo].slug.split('/')[1]}.</Empty>
            </>
          )}
          {!loading && d && (
            <>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {d.status && <Pill tone={d.status === 'identical' ? 'neutral' : d.status === 'diverged' ? 'warn' : 'info'}>{d.status}</Pill>}
                {d.ahead_by !== undefined && <Chip title="Commits in B not in A">{d.ahead_by} ahead</Chip>}
                {d.behind_by !== undefined && <Chip title="Commits in A not in B">{d.behind_by} behind</Chip>}
                <Chip>{d.total_commits ?? 0} commits</Chip>
                {d.files_changed !== undefined && <Chip>{d.files_changed} files</Chip>}
              </div>
              {ok?.fallback && <div className="banner info" role="note" style={{ marginTop: 8 }}>Showing recent commits on the branch; an exact diff is unavailable (refs may be identical or merged).</div>}

              {!!d.commits?.length && (
                <>
                  <h3 style={h3}>Commits ({d.commits.length})</h3>
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {d.commits.slice(0, 30).map(c => (
                      <li key={c.sha} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 10px', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 6 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ overflowWrap: 'anywhere' }}>{c.message.split('\n')[0]}</div>
                          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)' }}>{c.author_login || c.author} · {fmtDateTime(c.date)}</div>
                        </div>
                        <a href={c.url} target="_blank" rel="noopener noreferrer" style={{ ...mono, fontSize: 'var(--fs-xs)', color: 'var(--accent-text)', whiteSpace: 'nowrap' }} aria-label={`Commit ${c.short_sha} on GitHub`}>{c.short_sha}</a>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {!!d.files?.length && (
                <>
                  <h3 style={h3}>Files changed ({d.files_changed ?? d.files.length}{(d.files_changed ?? 0) > 50 ? ', first 50 shown' : ''})</h3>
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {d.files.slice(0, 50).map(f => (
                      <li key={f.filename} style={{ ...mono, display: 'flex', gap: 8, alignItems: 'center', padding: '5px 10px', background: 'var(--panel-2)', borderRadius: 4, fontSize: 'var(--fs-xs)' }}>
                        <span title={f.status} aria-label={f.status} style={{ fontWeight: 700, minWidth: 14 }}>{fileBadge(f.status)}</span>
                        <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{f.filename}</span>
                        <span style={{ color: 'var(--ok-text)' }}>+{f.additions}</span>
                        <span style={{ color: 'var(--bad-text)' }}>-{f.deletions}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {!d.commits?.length && !d.files?.length && <Empty>No commits between these refs.</Empty>}
            </>
          )}
        </div>
      </div>
    </>
  );
}
