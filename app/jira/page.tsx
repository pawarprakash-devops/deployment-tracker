'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

type Theme = 'light' | 'dark';
interface Issue { key: string; summary: string; status: string; statusCategory: string; type: string; priority: string | null; assignee: string | null; reporter?: string | null; labels?: string[]; created?: string; updated?: string; url: string }
interface Person { id: string; name: string }
interface FilterOptions { people: Person[]; types: string[]; statuses: string[]; priorities: string[]; labels: string[]; components: string[]; versions: string[] }
interface Filters { assignee: string[]; reporter: string[]; type: string[]; priority: string[]; status: string[]; label: string[]; component: string[]; version: string[]; from: string; to: string; q: string }
const EMPTY: Filters = { assignee: [], reporter: [], type: [], priority: [], status: [], label: [], component: [], version: [], from: '', to: '', q: '' };
const LISTS = ['assignee', 'reporter', 'type', 'priority', 'status', 'label', 'component', 'version'] as const;
const toQS = (f: Filters) => { const sp = new URLSearchParams(); for (const k of LISTS) if (f[k].length) sp.set(k, f[k].join(',')); if (f.from) sp.set('from', f.from); if (f.to) sp.set('to', f.to); if (f.q.trim()) sp.set('q', f.q.trim()); return sp.toString(); };
const fromQS = (qs: string): Filters => { const sp = new URLSearchParams(qs); const f: Filters = { ...EMPTY, from: sp.get('from') || '', to: sp.get('to') || '', q: sp.get('q') || '' }; for (const k of LISTS) f[k] = (sp.get(k) || '').split(',').filter(Boolean); return f; };
const activeCount = (f: Filters) => LISTS.filter((k) => f[k].length).length + (f.from || f.to ? 1 : 0) + (f.q.trim() ? 1 : 0);
const isoDaysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
interface Count { name: string; value: number }
interface Sprint { name: string; goal: string | null; startDate: string | null; endDate: string | null; boardName: string; total: number; byStage: Count[]; byStatus: Count[] }
interface Stats {
  configured: boolean; error?: string; projects?: string[]; windowDays?: number; doneStatuses?: string[];
  totals?: Record<string, number>; byStage?: Count[]; byStatus?: Count[]; byAssignee?: Count[]; assigneeSampled?: number;
  openBugs?: Issue[]; sprints?: Sprint[]; sprintError?: string;
}
interface Deployed {
  configured: boolean; jiraError?: string; error?: string;
  tickets: { key: string; environments: Record<string, string> }[]; issues: Record<string, Issue>;
}

interface Aged extends Issue { ageDays: number | null; createdDays: number | null; environments?: string[]; inProd?: boolean }
interface LT { count: number; medianDays: number; p90Days: number }
interface Insights {
  configured: boolean; error?: string; stuckDays?: number;
  readyToShip?: { total: number; statuses: string[]; shownOldestFirst: number; notInProd: number; items: Aged[] };
  stuck?: { total: number; statuses: string[]; items: Aged[] };
  bugs?: { weekly: { weekStart: string; created: number; closed: number }[]; byPriority: Count[]; byAge: Count[] };
  leadTime?: { overall: LT; byType: Record<string, LT>; createdToProd: LT; windowDays: number; sampled: number };
}
interface NotesItem { id: string; environment: string; branch: string | null; version: string | null; started_at: string; keys: string[] }

const ENV_ORDER = ['Preview', 'Demo-Preview', 'QA', 'Stage', 'Stage EUW2', 'Pre-Prod', 'Pre-Prod USW', 'Production (Ankura)', 'Production (Neotia/Babyjoy)', 'Production'];
const catColor = (c: string) => (c === 'done' ? 'var(--ok)' : c === 'indeterminate' ? 'var(--warn)' : 'var(--muted)');

export default function JiraDashboard() {
  const [theme, setTheme] = useState<Theme>('dark');
  const [auth, setAuth] = useState<'loading' | 'admin' | 'viewer'>('loading');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState<Stats | null>(null);
  const [deployed, setDeployed] = useState<Deployed | null>(null);
  const [loading, setLoading] = useState(false);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [stuckDays, setStuckDays] = useState(5);
  const [notesList, setNotesList] = useState<NotesItem[]>([]);
  const [notesId, setNotesId] = useState('');
  const [notesMd, setNotesMd] = useState('');
  const [copied, setCopied] = useState(false);
  const [filters, setFilters] = useState<Filters>(EMPTY);   // what the bar shows
  const [applied, setApplied] = useState<Filters>(EMPTY);   // what the dashboard is loaded with
  const [options, setOptions] = useState<FilterOptions | null>(null);
  const [explorer, setExplorer] = useState<{ total: number; shown: number; issues: Issue[]; error?: string } | null>(null);
  const [sort, setSort] = useState('updated');

  useEffect(() => {
    try { const t = localStorage.getItem('tracker-theme'); if (t === 'light' || t === 'dark') setTheme(t); } catch {}
    try { const f = fromQS(window.location.search); setFilters(f); setApplied(f); } catch {}
    fetch('/api/auth/session').then((r) => r.json()).then((s) => setAuth(s.role === 'admin' ? 'admin' : 'viewer')).catch(() => setAuth('viewer'));
  }, []);

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    const qs = toQS(applied);
    const f = (fresh ? '&fresh=1' : '') + (qs ? `&${qs}` : '');
    const [s, d, ins, nl, ex] = await Promise.all([
      fetch(`/api/jira/stats?days=${days}${f}`).then((r) => r.json()).catch((e) => ({ configured: true, error: String(e) })),
      fetch('/api/jira/deployed').then((r) => r.json()).catch(() => null),
      fetch(`/api/jira/insights?stuckDays=${stuckDays}${f}`).then((r) => r.json()).catch((e) => ({ configured: true, error: String(e) })),
      fetch('/api/jira/release-notes').then((r) => r.json()).catch(() => null),
      fetch(`/api/jira/search?sort=${sort}${f}`).then((r) => r.json()).catch((e) => ({ error: String(e) })),
    ]);
    setStats(s); setDeployed(d); setInsights(ins); setNotesList(nl?.deployments || []); setExplorer(ex); setLoading(false);
  }, [days, stuckDays, applied, sort]);

  useEffect(() => {
    if (auth !== 'admin') return;
    fetch('/api/jira/filters').then((r) => r.json()).then((o) => { if (!o.error && o.people) setOptions(o); }).catch(() => {});
  }, [auth]);

  const apply = (f: Filters) => {
    setFilters(f); setApplied(f);
    try { const qs = toQS(f); window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname); } catch {}
  };

  const loadNotes = async (id: string) => {
    setNotesId(id); setNotesMd(''); setCopied(false);
    if (!id) return;
    const r = await fetch(`/api/jira/release-notes?id=${id}`).then((x) => x.json()).catch(() => null);
    setNotesMd(r?.markdown || r?.error || 'Failed to load');
  };
  const copyNotes = async () => { try { await navigator.clipboard.writeText(notesMd); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} };

  useEffect(() => { if (auth === 'admin') load(); }, [auth, load]);

  const login = async () => {
    const res = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    if (res.ok) { setAuth('admin'); setLoginError(''); setPassword(''); } else setLoginError('Invalid password');
  };

  const notConfigured = stats && stats.configured === false;
  const t = stats?.totals;
  const envs = deployed ? ENV_ORDER.filter((e) => deployed.tickets.some((x) => x.environments[e])).concat(
    [...new Set(deployed.tickets.flatMap((x) => Object.keys(x.environments)))].filter((e) => !ENV_ORDER.includes(e))) : [];

  return (
    <div className={`jwrap ${theme}`}>
      <header className="jtop">
        <div>
          <h1>Jira Dashboard</h1>
          <div className="jsub">Delivery tickets and what has shipped to each environment{stats?.projects ? ` · ${stats.projects.join(', ')}` : ''}</div>
        </div>
        <div className="jactions">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Window">
            {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>Last {d} days</option>)}
          </select>
          <select value={stuckDays} onChange={(e) => setStuckDays(Number(e.target.value))} aria-label="Stuck threshold">
            {[3, 5, 7, 14, 30].map((d) => <option key={d} value={d}>Stuck ≥ {d}d</option>)}
          </select>
          <button onClick={() => load(true)} disabled={loading || auth !== 'admin'}>{loading ? 'Loading…' : '↺ Refresh'}</button>
          <Link href="/">← Deployments</Link>
        </div>
      </header>

      {auth === 'admin' && (
        <section className="jpanel jfilters">
          <div className="jfrow">
            <MultiSelect label="Assignee" options={[{ id: 'unassigned', name: 'Unassigned' }, ...(options?.people || [])]} value={filters.assignee} onChange={(v) => setFilters({ ...filters, assignee: v })} />
            <MultiSelect label="Reported by" options={options?.people || []} value={filters.reporter} onChange={(v) => setFilters({ ...filters, reporter: v })} />
            <MultiSelect label="Type" options={(options?.types || []).map((x) => ({ id: x, name: x }))} value={filters.type} onChange={(v) => setFilters({ ...filters, type: v })} />
            <MultiSelect label="Priority" options={(options?.priorities || []).map((x) => ({ id: x, name: x }))} value={filters.priority} onChange={(v) => setFilters({ ...filters, priority: v })} />
            <MultiSelect label="Status" options={(options?.statuses || []).map((x) => ({ id: x, name: x }))} value={filters.status} onChange={(v) => setFilters({ ...filters, status: v })} />
            <MultiSelect label="Label" options={(options?.labels || []).map((x) => ({ id: x, name: x }))} value={filters.label} onChange={(v) => setFilters({ ...filters, label: v })} />
            <MultiSelect label="Component" options={(options?.components || []).map((x) => ({ id: x, name: x }))} value={filters.component} onChange={(v) => setFilters({ ...filters, component: v })} />
            <MultiSelect label="Fix version" options={(options?.versions || []).map((x) => ({ id: x, name: x }))} value={filters.version} onChange={(v) => setFilters({ ...filters, version: v })} />
          </div>
          <div className="jfrow">
            <label className="jdate">Created from <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></label>
            <label className="jdate">to <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></label>
            <input className="jsearch" placeholder="Search text (summary, description, comments)…" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && apply(filters)} />
            <button className="jprimary" onClick={() => apply(filters)}>Apply filters</button>
            <button onClick={() => apply(EMPTY)} disabled={activeCount(filters) === 0 && activeCount(applied) === 0}>Clear</button>
          </div>
          <div className="jfrow jpresets">
            <span className="jfaint">Quick:</span>
            <button onClick={() => apply({ ...EMPTY, type: ['Bug'] })}>Bugs</button>
            <button onClick={() => apply({ ...EMPTY, assignee: ['unassigned'] })}>Unassigned</button>
            <button onClick={() => apply({ ...EMPTY, from: isoDaysAgo(7) })}>Created last 7d</button>
            <button onClick={() => apply({ ...EMPTY, type: ['Bug'], from: isoDaysAgo(7) })}>New bugs (7d)</button>
            <button onClick={() => apply({ ...EMPTY, type: ['Bug'], priority: ['Highest', 'High'] })}>High-priority bugs</button>
            {activeCount(applied) > 0 && <span className="jfaint">· {activeCount(applied)} filter{activeCount(applied) === 1 ? '' : 's'} applied to every section below (sprint panel and tickets-by-environment are not filtered)</span>}
          </div>
        </section>
      )}

      {auth === 'loading' && <div className="jpanel">Loading…</div>}

      {auth === 'viewer' && (
        <div className="jpanel jlogin">
          <h2>Admin login required</h2>
          <p>Jira data (summaries, assignees) is internal, so it is only shown to admins.</p>
          <input type="password" placeholder="Admin password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && login()} />
          <button onClick={login}>Login</button>
          {loginError && <div className="jerr">{loginError}</div>}
        </div>
      )}

      {auth === 'admin' && notConfigured && (
        <div className="jpanel">
          <h2>Jira is not configured</h2>
          <p>Add these Vercel environment variables (Production) and redeploy:</p>
          <pre>{`JIRA_BASE_URL=https://<your-site>.atlassian.net
JIRA_EMAIL=<atlassian account email>
JIRA_API_TOKEN=<API token>
JIRA_PROJECT_KEYS=CORE,EMR   # comma separated`}</pre>
        </div>
      )}

      {auth === 'admin' && stats && stats.configured && stats.error && <div className="jpanel jerr">Metrics: {stats.error}</div>}

      {auth === 'admin' && t && (
        <>
          <div className="jhud">
            {[['OPEN', t.open], ['IN DEVELOPMENT', t.inDevelopment], ['REVIEW + QA + PASSED', t.inQA], ['OPEN BUGS', t.openBugs],
              ['CREATED 7D', t.createdLast7d], ['DONE 7D', t.doneLast7d], [`CREATED ${days}D`, t.createdInWindow], [`DONE ${days}D`, t.doneInWindow], [`RELEASED TO PROD ${days}D`, t.releasedInWindow]].map(([l, v]) => (
              <div className="jcard" key={String(l)}><div className="jlabel">{l}</div><div className="jvalue">{v}</div></div>
            ))}
          </div>
          <div className="jnote">Counts cover all issues in {stats.projects?.join(', ')}. “Done” = moved into {stats.doneStatuses?.length ? stats.doneStatuses.join(', ') : 'a resolved state'} within the window (override with <code>JIRA_DONE_STATUSES</code>).</div>

          {stats.sprints && stats.sprints.length > 0 && stats.sprints.map((sp) => {
            const days = sp.endDate ? Math.ceil((new Date(sp.endDate).getTime() - Date.now()) / 86400000) : null;
            return (
              <section className="jpanel" key={sp.name}>
                <h2>Active sprint · {sp.name} <span className="jfaint">({sp.boardName})</span></h2>
                <div className="jnote">
                  {sp.startDate && new Date(sp.startDate).toLocaleDateString()} → {sp.endDate && new Date(sp.endDate).toLocaleDateString()}
                  {days !== null && ` · ${days >= 0 ? `${days} day${days === 1 ? '' : 's'} left` : `ended ${-days} day(s) ago`}`} · {sp.total} issues
                  {sp.goal ? ` · Goal: ${sp.goal}` : ''}
                </div>
                <div className="jgrid" style={{ marginBottom: 0 }}>
                  <Bars title="By stage" data={sp.byStage} bare />
                  <Bars title="By status" data={sp.byStatus} bare />
                </div>
              </section>
            );
          })}
          {stats.sprintError && <div className="jnote">Sprint data unavailable: {stats.sprintError}</div>}

          <div className="jgrid">
            <Bars title="By stage (all issues)" data={stats.byStage || []} />
            <Bars title="By status (all)" data={stats.byStatus || []} />
            <Bars title={`Open by assignee (latest ${stats.assigneeSampled ?? 0} updated)`} data={stats.byAssignee || []} />
          </div>

          <section className="jpanel">
            <h2>Open bugs</h2>
            {stats.openBugs && stats.openBugs.length ? <IssueTable issues={stats.openBugs} /> : <div className="jnote">No open bugs 🎉</div>}
          </section>
        </>
      )}

      {auth === 'admin' && insights && insights.error && <div className="jpanel jerr">Insights: {insights.error}</div>}

      {auth === 'admin' && insights?.readyToShip && (
        <section className="jpanel">
          <h2>Ready to ship · {insights.readyToShip.total} in {insights.readyToShip.statuses.join(', ') || 'QA Passed'}</h2>
          <div className="jnote">Oldest first (showing {insights.readyToShip.shownOldestFirst}). {insights.readyToShip.notInProd} of these have not been seen in a Production deployment. “Idle” = days since the ticket was last updated.</div>
          <AgedTable items={insights.readyToShip.items} showEnv />
        </section>
      )}

      {auth === 'admin' && insights?.stuck && (
        <section className="jpanel">
          <h2>Stuck tickets · {insights.stuck.total} idle ≥ {insights.stuckDays} days</h2>
          <div className="jnote">In {insights.stuck.statuses.join(', ')} with no update for {insights.stuckDays}+ days (oldest first, top 40).</div>
          {insights.stuck.items.length ? <AgedTable items={insights.stuck.items} /> : <div className="jnote">Nothing stuck 🎉</div>}
        </section>
      )}

      {auth === 'admin' && insights?.bugs && (
        <section className="jpanel">
          <h2>Bug trends</h2>
          <WeeklyChart weeks={insights.bugs.weekly} />
          <div className="jgrid" style={{ marginTop: 14, marginBottom: 0 }}>
            <Bars title="Open bugs by priority" data={insights.bugs.byPriority} bare />
            <Bars title="Open bugs by age" data={insights.bugs.byAge} bare />
          </div>
        </section>
      )}

      {auth === 'admin' && insights?.leadTime && (
        <section className="jpanel">
          <h2>Lead time <span className="jfaint">(tasks/stories/bugs done in the last {insights.leadTime.windowDays} days, {insights.leadTime.sampled} sampled; sub-tasks and epics excluded)</span></h2>
          <div className="jhud" style={{ marginBottom: 0 }}>
            <LTCard label="CREATED → DONE (all)" lt={insights.leadTime.overall} />
            {Object.entries(insights.leadTime.byType).filter(([, v]) => v.count >= 3).slice(0, 4).map(([t, v]) => <LTCard key={t} label={`${t.toUpperCase()}`} lt={v} />)}
            <LTCard label="CREATED → FIRST PROD DEPLOY" lt={insights.leadTime.createdToProd} />
          </div>
        </section>
      )}

      {auth === 'admin' && (
        <section className="jpanel">
          <h2>Release notes</h2>
          <div className="jnote">Pick a deployment that references Jira tickets; copy the markdown into release notes or chat.</div>
          <select value={notesId} onChange={(e) => loadNotes(e.target.value)} style={{ maxWidth: '100%' }}>
            <option value="">Select a deployment…</option>
            {notesList.map((n) => <option key={n.id} value={n.id}>{n.environment} · {new Date(n.started_at).toLocaleString()} · {n.keys.join(', ')}</option>)}
          </select>
          {notesMd && (<>
            <pre>{notesMd}</pre>
            <button onClick={copyNotes}>{copied ? 'Copied ✓' : 'Copy markdown'}</button>
          </>)}
          {notesList.length === 0 && <div className="jnote">No deployments with Jira keys yet — they appear once deploys carry <code>Jira: VID-123</code> in their notes.</div>}
        </section>
      )}

      {auth === 'admin' && explorer && (
        <section className="jpanel">
          <h2>Tickets {explorer.total !== undefined && <span className="jfaint">· {explorer.total} match{explorer.total === 1 ? '' : 'es'}{explorer.shown < explorer.total ? ` (showing ${explorer.shown})` : ''}</span>}</h2>
          {explorer.error && <div className="jerr">{explorer.error}</div>}
          <div className="jfrow">
            <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
              <option value="updated">Recently updated</option><option value="created">Newest first</option><option value="oldest">Oldest first</option>
              <option value="priority">Priority</option><option value="idle">Longest idle</option>
            </select>
            <button onClick={() => exportCsv(explorer.issues)} disabled={!explorer.issues?.length}>Export CSV</button>
          </div>
          {explorer.issues?.length ? <ExplorerTable issues={explorer.issues} /> : !explorer.error && <div className="jnote">No tickets match these filters.</div>}
        </section>
      )}

      {auth === 'admin' && deployed && (
        <section className="jpanel">
          <h2>Tickets by environment</h2>
          <div className="jnote">Jira keys found in notes, branches, versions and ticket links of the last 300 successful deployments. ✓ = deployed there.</div>
          {deployed.error && <div className="jerr">{deployed.error}</div>}
          {deployed.jiraError && <div className="jerr">Jira lookup failed: {deployed.jiraError}</div>}
          {deployed.tickets.length === 0 ? <div className="jnote">No Jira keys found in recent deployments.</div> : (
            <div className="jscroll">
              <table>
                <thead><tr><th>Ticket</th><th>Summary</th><th>Status</th>{envs.map((e) => <th key={e} className="jc">{e}</th>)}</tr></thead>
                <tbody>
                  {deployed.tickets.map(({ key, environments }) => {
                    const i = deployed.issues[key];
                    return (
                      <tr key={key}>
                        <td className="jmono">{i ? <a href={i.url} target="_blank" rel="noopener noreferrer">{key}</a> : key}</td>
                        <td>{i?.summary || <span className="jfaint">—</span>}</td>
                        <td>{i ? <span style={{ color: catColor(i.statusCategory) }}>{i.status}</span> : '—'}</td>
                        {envs.map((e) => <td key={e} className="jc" title={environments[e] ? new Date(environments[e]).toLocaleString() : ''}>{environments[e] ? '✓' : ''}</td>)}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <style jsx global>{`
        body { margin: 0; }
        .jwrap { --bg:#f0f0f0; --panel:#fff; --border:#e2e4e8; --text:#2b3445; --muted:#505050; --faint:#8a8c91; --accent:#e17e61; --ok:#2e7d32; --warn:#d97706; --bad:#dc2626;
          min-height:100vh; padding:24px clamp(16px,2.5vw,32px) 80px; background:var(--bg); color:var(--text); font-family:'Montserrat','Inter',system-ui,sans-serif; }
        .jwrap.dark { --bg:#151c28; --panel:#1e2737; --border:rgba(255,255,255,.08); --text:#e8edf5; --muted:#94a3b8; --faint:#64748b; --ok:#4ade80; --warn:#fbbf24; --bad:#f87171; }
        .jtop { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap; margin-bottom:20px; }
        .jtop h1 { margin:0; font-size:24px; } .jsub { color:var(--muted); font-size:13px; margin-top:4px; }
        .jactions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        .jwrap button, .jwrap select, .jactions a, .jwrap input { background:var(--panel); color:var(--text); border:1px solid var(--border); border-radius:8px; padding:8px 12px; font-size:13px; text-decoration:none; font-family:inherit; }
        .jwrap button { cursor:pointer; } .jwrap button:disabled { opacity:.5; cursor:default; }
        .jpanel { background:var(--panel); border:1px solid var(--border); border-radius:14px; padding:18px; margin-bottom:16px; }
        .jpanel h2 { margin:0 0 10px; font-size:15px; }
        .jlogin { max-width:420px; display:flex; flex-direction:column; gap:10px; }
        .jhud { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:10px; margin-bottom:16px; }
        .jcard { background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:12px 14px; }
        .jlabel { font-size:10.5px; letter-spacing:.06em; color:var(--faint); font-weight:700; } .jvalue { font-size:26px; font-weight:700; margin-top:4px; }
        .jgrid { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:16px; margin-bottom:16px; }
        .jbar { display:grid; grid-template-columns:minmax(80px,140px) 1fr 36px; gap:8px; align-items:center; font-size:12.5px; margin:6px 0; }
        .jbar .track { background:rgba(128,128,128,.15); border-radius:4px; height:8px; } .jbar .fill { background:var(--accent); height:8px; border-radius:4px; }
        .jbar .name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; } .jbar .num { text-align:right; color:var(--muted); }
        .jscroll { overflow-x:auto; } table { width:100%; border-collapse:collapse; font-size:13px; }
        th, td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--border); } th { color:var(--faint); font-size:11px; letter-spacing:.05em; white-space:nowrap; }
        .jc { text-align:center; color:var(--ok); font-weight:700; } .jmono { font-family:'JetBrains Mono',monospace; white-space:nowrap; } .jmono a { color:var(--accent); }
        .jnote, .jfaint { color:var(--muted); font-size:12.5px; margin:6px 0; } .jerr { color:var(--bad); font-size:13px; margin:6px 0; }
        .jweeks { display:flex; gap:10px; align-items:flex-end; margin-top:8px; }
        .jweek { flex:1; min-width:36px; text-align:center; } .jbars { height:110px; display:flex; gap:3px; align-items:flex-end; justify-content:center; }
        .jbars span { display:block; width:40%; max-width:22px; border-radius:3px 3px 0 0; min-height:1px; } .jwl { font-size:11px; color:var(--faint); margin-top:4px; } .jwn { font-size:11px; color:var(--muted); }
        .jfilters { position:relative; z-index:5; } .jfrow { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:8px; } .jpresets button { padding:4px 10px; font-size:12px; border-radius:16px; }
        .jfrow button.jprimary { background:var(--accent); color:#fff; border-color:var(--accent); } .jdate { font-size:12px; color:var(--muted); display:flex; gap:6px; align-items:center; } .jsearch { flex:1; min-width:220px; }
        .jms { position:relative; } .jms-on { border-color:var(--accent) !important; } .jms-back { position:fixed; inset:0; z-index:9; }
        .jms-pop { position:absolute; top:calc(100% + 4px); left:0; z-index:10; width:260px; background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:8px; box-shadow:0 8px 24px rgba(0,0,0,.35); display:flex; flex-direction:column; gap:6px; }
        .jms-list { max-height:240px; overflow:auto; display:flex; flex-direction:column; } .jms-list label { display:flex; gap:8px; align-items:center; padding:4px 6px; font-size:13px; border-radius:6px; cursor:pointer; } .jms-list label:hover { background:rgba(128,128,128,.12); }
        pre { background:rgba(128,128,128,.12); padding:12px; border-radius:8px; overflow-x:auto; font-size:12.5px; }
      `}</style>
    </div>
  );
}

function Bars({ title, data, bare }: { title: string; data: Count[]; bare?: boolean }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className={bare ? '' : 'jpanel'} style={{ marginBottom: 0 }}>
      <h2 style={bare ? { fontSize: 13, color: 'var(--muted)' } : undefined}>{title}</h2>
      {data.length === 0 && <div className="jnote">No data</div>}
      {data.slice(0, 10).map((d) => (
        <div className="jbar" key={d.name}>
          <span className="name" title={d.name}>{d.name}</span>
          <span className="track"><span className="fill" style={{ width: `${(d.value / max) * 100}%`, display: 'block' }} /></span>
          <span className="num">{d.value}</span>
        </div>
      ))}
    </div>
  );
}

function IssueTable({ issues }: { issues: Issue[] }) {
  return (
    <div className="jscroll">
      <table>
        <thead><tr><th>Key</th><th>Summary</th><th>Status</th><th>Priority</th><th>Assignee</th></tr></thead>
        <tbody>
          {issues.map((i) => (
            <tr key={i.key}>
              <td className="jmono"><a href={i.url} target="_blank" rel="noopener noreferrer">{i.key}</a></td>
              <td>{i.summary}</td>
              <td style={{ color: catColor(i.statusCategory) }}>{i.status}</td>
              <td>{i.priority || '—'}</td>
              <td>{i.assignee || 'Unassigned'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AgedTable({ items, showEnv }: { items: Aged[]; showEnv?: boolean }) {
  return (
    <div className="jscroll">
      <table>
        <thead><tr><th>Key</th><th>Summary</th><th>Status</th><th>Assignee</th><th className="jc">Idle</th>{showEnv && <th>Deployed to</th>}</tr></thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.key}>
              <td className="jmono"><a href={i.url} target="_blank" rel="noopener noreferrer">{i.key}</a></td>
              <td>{i.summary}</td>
              <td style={{ color: catColor(i.statusCategory) }}>{i.status}</td>
              <td>{i.assignee || 'Unassigned'}</td>
              <td className="jc" style={{ color: (i.ageDays ?? 0) >= 14 ? 'var(--bad)' : (i.ageDays ?? 0) >= 7 ? 'var(--warn)' : 'var(--muted)' }}>{i.ageDays ?? '—'}d</td>
              {showEnv && <td>{i.environments && i.environments.length ? <span style={{ color: i.inProd ? 'var(--ok)' : 'var(--muted)' }}>{i.environments.join(', ')}</span> : <span className="jfaint">not seen</span>}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WeeklyChart({ weeks }: { weeks: { weekStart: string; created: number; closed: number }[] }) {
  const max = Math.max(1, ...weeks.flatMap((w) => [w.created, w.closed]));
  return (
    <div>
      <div className="jnote"><span style={{ color: 'var(--bad)' }}>■</span> created &nbsp; <span style={{ color: 'var(--ok)' }}>■</span> closed (moved to a done status) — per week</div>
      <div className="jweeks">
        {weeks.map((w) => (
          <div key={w.weekStart} className="jweek" title={`Week of ${w.weekStart}: ${w.created} created, ${w.closed} closed`}>
            <div className="jbars">
              <span style={{ height: `${(w.created / max) * 100}%`, background: 'var(--bad)' }} />
              <span style={{ height: `${(w.closed / max) * 100}%`, background: 'var(--ok)' }} />
            </div>
            <div className="jwl">{w.weekStart.slice(5)}</div>
            <div className="jwn">{w.created}/{w.closed}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LTCard({ label, lt }: { label: string; lt: LT }) {
  return (
    <div className="jcard">
      <div className="jlabel">{label}</div>
      <div className="jvalue">{lt.count ? `${lt.medianDays}d` : '—'}</div>
      <div className="jfaint">{lt.count ? `median · p90 ${lt.p90Days}d · n=${lt.count}` : 'no data'}</div>
    </div>
  );
}

function MultiSelect({ label, options, value, onChange }: { label: string; options: { id: string; name: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const shown = options.filter((o) => o.name.toLowerCase().includes(q.toLowerCase())).slice(0, 200);
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const names = value.map((v) => options.find((o) => o.id === v)?.name || v);
  return (
    <div className="jms">
      <button type="button" className={value.length ? 'jms-on' : ''} onClick={() => setOpen(!open)} title={names.join(', ')}>
        {label}{value.length ? `: ${value.length === 1 ? names[0] : `${value.length} selected`}` : ''} ▾
      </button>
      {open && (<>
        <div className="jms-back" onClick={() => setOpen(false)} />
        <div className="jms-pop">
          <input placeholder={`Search ${label.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <div className="jms-list">
            {shown.length === 0 && <div className="jfaint" style={{ padding: 6 }}>{options.length ? 'No match' : 'Loading…'}</div>}
            {shown.map((o) => (
              <label key={o.id}><input type="checkbox" checked={value.includes(o.id)} onChange={() => toggle(o.id)} /> {o.name}</label>
            ))}
          </div>
          {value.length > 0 && <button type="button" onClick={() => onChange([])}>Clear {label.toLowerCase()}</button>}
        </div>
      </>)}
    </div>
  );
}

const idle = (iso?: string) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)) : null);

function ExplorerTable({ issues }: { issues: Issue[] }) {
  return (
    <div className="jscroll">
      <table>
        <thead><tr><th>Key</th><th>Summary</th><th>Type</th><th>Status</th><th>Priority</th><th>Assignee</th><th>Reporter</th><th>Labels</th><th>Created</th><th className="jc">Idle</th></tr></thead>
        <tbody>
          {issues.map((i) => (
            <tr key={i.key}>
              <td className="jmono"><a href={i.url} target="_blank" rel="noopener noreferrer">{i.key}</a></td>
              <td>{i.summary}</td>
              <td>{i.type}</td>
              <td style={{ color: catColor(i.statusCategory) }}>{i.status}</td>
              <td>{i.priority || '—'}</td>
              <td>{i.assignee || <span className="jfaint">Unassigned</span>}</td>
              <td>{i.reporter || '—'}</td>
              <td className="jfaint">{(i.labels || []).join(', ')}</td>
              <td className="jfaint" style={{ whiteSpace: 'nowrap' }}>{i.created ? new Date(i.created).toLocaleDateString() : '—'}</td>
              <td className="jc" style={{ color: 'var(--muted)' }}>{idle(i.updated) ?? '—'}d</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function exportCsv(issues: Issue[]) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Key', 'Summary', 'Type', 'Status', 'Priority', 'Assignee', 'Reporter', 'Labels', 'Created', 'Updated', 'URL']]
    .concat(issues.map((i) => [i.key, i.summary, i.type, i.status, i.priority || '', i.assignee || '', i.reporter || '', (i.labels || []).join(' '), i.created || '', i.updated || '', i.url]));
  const blob = new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `jira-tickets-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  URL.revokeObjectURL(a.href);
}
