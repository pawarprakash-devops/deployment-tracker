'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

type Theme = 'light' | 'dark';
interface Issue { key: string; summary: string; status: string; statusCategory: string; type: string; priority: string | null; assignee: string | null; url: string }
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

  useEffect(() => {
    try { const t = localStorage.getItem('tracker-theme'); if (t === 'light' || t === 'dark') setTheme(t); } catch {}
    fetch('/api/auth/session').then((r) => r.json()).then((s) => setAuth(s.role === 'admin' ? 'admin' : 'viewer')).catch(() => setAuth('viewer'));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [s, d, ins, nl] = await Promise.all([
      fetch(`/api/jira/stats?days=${days}`).then((r) => r.json()).catch((e) => ({ configured: true, error: String(e) })),
      fetch('/api/jira/deployed').then((r) => r.json()).catch(() => null),
      fetch(`/api/jira/insights?stuckDays=${stuckDays}`).then((r) => r.json()).catch((e) => ({ configured: true, error: String(e) })),
      fetch('/api/jira/release-notes').then((r) => r.json()).catch(() => null),
    ]);
    setStats(s); setDeployed(d); setInsights(ins); setNotesList(nl?.deployments || []); setLoading(false);
  }, [days, stuckDays]);

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
          <button onClick={load} disabled={loading || auth !== 'admin'}>{loading ? 'Loading…' : '↺ Refresh'}</button>
          <Link href="/">← Deployments</Link>
        </div>
      </header>

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
            {[['OPEN', t.open], ['IN DEVELOPMENT', t.inDevelopment], ['IN QA / QA PASSED', t.inQA], ['OPEN BUGS', t.openBugs],
              ['CREATED 7D', t.createdLast7d], ['DONE 7D', t.doneLast7d], [`CREATED ${days}D`, t.createdInWindow], [`DONE ${days}D`, t.doneInWindow]].map(([l, v]) => (
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
            <Bars title="Open by stage" data={stats.byStage || []} />
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
          <h2>Lead time <span className="jfaint">(tickets done in the last {insights.leadTime.windowDays} days, {insights.leadTime.sampled} sampled)</span></h2>
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
