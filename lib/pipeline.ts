import pool from './db';
import { extractJiraKeys, jiraConfigured, jiraIssuesByKeys, stageOf } from './jira';
import type { BadgeId, ColumnId, EnvState, PipelineColumn, PipelineEnvEntry, PipelineResponse, PipelineTicket } from './pipeline-types';

const SUCCESS_RE = /(^|\s)success$/i;
const AWAITING_RE = /(^|\s)awaiting approval$/i; // 'Awaiting approval' / 'Rerun - Awaiting approval': paused on an approval, not running
const QUEUED_RE = /(^|\s)queued$/i; // 'Queued' / 'Rerun - Queued': waiting in the deploy FIFO, not running
const WINDOW = 300;
const MAX_TICKETS = 150;

// environments.name -> board column (see docs/redesign/02-API-SPEC.md 1.4)
export function columnOf(env: string, isProduction: boolean): { id: ColumnId; rank: number } {
  const e = env.toLowerCase();
  if (e === 'preview') return { id: 'preview', rank: 0 };
  if (e.startsWith('demo')) return { id: 'demo', rank: 1 };
  if (e === 'qa') return { id: 'qa', rank: 1 };
  if (e.startsWith('stage')) return { id: 'stage', rank: 2 };
  // US-West first: 'Pre-Prod USW' would otherwise fall into generic preprod. Pre-Prod USW is promoted from Pre-Prod
  // India (preprod -> preprod_usw -> prod_citmer), so it ranks between Pre-Prod and the production columns.
  // Production USW is matched on a 'prod'/'production' PREFIX so 'Pre-Prod USW' can never land in a prod column;
  // a name built from its release branch (prod_citmer / citmer) also maps there, unless it starts with pre-prod.
  if (/^pre-?prod\b.*\busw\b/.test(e)) return { id: 'preprod-usw', rank: 3.5 };
  if (/^prod(uction)?\b.*\busw\b/.test(e)) return { id: 'prod-usw', rank: 4 };
  if (e.includes('citmer') && !/^pre[-_ ]?prod/.test(e)) return { id: 'prod-usw', rank: 4 };
  if (e.startsWith('pre-prod') || e.startsWith('preprod')) return { id: 'preprod', rank: 3 };
  if (e.includes('ankura')) return { id: 'prod-ankura', rank: 4 };
  if (e.includes('neotia') || e.includes('babyjoy')) return { id: 'prod-neotia', rank: 4 };
  return { id: 'other', rank: isProduction || /^production/i.test(env) ? 4 : 1 };
}

const COLUMN_NAMES: Record<ColumnId, string> = {
  preview: 'Preview',
  demo: 'Demo',
  qa: 'QA',
  stage: 'Stage',
  preprod: 'Pre-Prod',
  'preprod-usw': 'Pre-Prod · USW',
  'prod-ankura': 'Prod · Ankura',
  'prod-neotia': 'Prod · Neotia',
  'prod-usw': 'Prod · USW',
  other: 'Other',
};

interface Row {
  id: string;
  environment: string;
  status: string;
  deployment_type: string | null;
  branch: string | null;
  version: string | null;
  frontend_branch: string | null;
  backend_branch: string | null;
  frontend_version: string | null;
  backend_version: string | null;
  deployed_by: string | null;
  ticket_link: string | null;
  notes: string | null;
  started_at: Date;
}

const iso = (d: Date | string) => new Date(d).toISOString();

export async function buildPipeline(opts: { jira: boolean; sinceDays?: number }): Promise<PipelineResponse> {
  const raw = Number.isFinite(opts.sinceDays) ? Math.trunc(opts.sinceDays as number) : 30;
  const sinceDays = Math.min(Math.max(raw, 1), 90); // always an integer: it is bound as $1::int
  const cols = `id, environment, status, deployment_type, branch, version, frontend_branch, backend_branch,
    frontend_version, backend_version, deployed_by, ticket_link, notes, started_at`;

  const [envRes, okRes, otherRes] = await Promise.all([
    pool.query(`SELECT name, is_production, display_order FROM environments ORDER BY display_order, name`),
    pool.query<Row>(
      `SELECT ${cols} FROM deployments
       WHERE started_at IS NOT NULL AND status ~* '(^|\\s)success$' AND (deployed_by IS NULL OR deployed_by NOT LIKE '%Deployment Tracker%')
       ORDER BY started_at DESC LIMIT ${WINDOW}`
    ),
    pool.query<Row>(
      `SELECT ${cols} FROM deployments
       WHERE status !~* '(^|\\s)success$' AND started_at IS NOT NULL AND started_at >= NOW() - ($1::int * INTERVAL '1 day')
         AND (deployed_by IS NULL OR deployed_by NOT LIKE '%Deployment Tracker%')
       ORDER BY started_at DESC LIMIT ${WINDOW}`,
      [sinceDays]
    ),
  ]);

  // ---- columns --------------------------------------------------------------------------------
  const envMeta = new Map<string, { col: ColumnId; rank: number; prod: boolean; order: number }>();
  const columns = new Map<ColumnId, PipelineColumn & { _order: number }>();
  const ensureEnv = (name: string, prod = false, order = 999) => {
    let m = envMeta.get(name);
    if (!m) {
      const c = columnOf(name, prod);
      m = { col: c.id, rank: c.rank, prod, order };
      envMeta.set(name, m);
      const existing = columns.get(c.id);
      if (existing) {
        existing.environments.push(name);
        existing.isProduction ||= prod || c.rank === 4;
        existing._order = Math.min(existing._order, order);
      } else {
        columns.set(c.id, {
          id: c.id,
          name: COLUMN_NAMES[c.id],
          environments: [name],
          rank: c.rank,
          isProduction: prod || c.rank === 4,
          health: { lastSuccessAt: null, latest: null },
          activeDeploy: null,
          queuedDeploy: null,
          queuedCount: 0,
          awaitingDeploy: null,
          awaitingCount: 0,
          ticketCount: 0,
          _order: order,
        });
      }
    }
    return m;
  };
  for (const e of envRes.rows) ensureEnv(e.name, e.is_production, e.display_order);

  // ---- merge rows newest first ----------------------------------------------------------------
  const all = [...okRes.rows, ...otherRes.rows].sort((a, b) => +new Date(b.started_at) - +new Date(a.started_at));
  const tickets = new Map<string, { envs: Map<string, PipelineEnvEntry>; hotfix: boolean; latestAt: string }>();
  let unlinked = 0;

  for (const r of all) {
    const meta = ensureEnv(r.environment);
    const col = columns.get(meta.col)!;
    const ok = SUCCESS_RE.test(r.status);
    const at = iso(r.started_at);
    if (!col.health.latest) col.health.latest = { id: r.id, status: r.status, at };
    if (ok && !col.health.lastSuccessAt) col.health.lastSuccessAt = at;
    if (/in progress/i.test(r.status) && !col.activeDeploy) col.activeDeploy = { id: r.id, status: r.status, startedAt: at };
    if (AWAITING_RE.test(r.status)) {
      col.awaitingCount = (col.awaitingCount ?? 0) + 1;
      if (!col.awaitingDeploy) col.awaitingDeploy = { id: r.id, status: r.status, startedAt: at, note: r.notes?.trim() || null };
    }
    if (QUEUED_RE.test(r.status)) {
      col.queuedCount = (col.queuedCount ?? 0) + 1;
      if (!col.queuedDeploy) col.queuedDeploy = { id: r.id, status: r.status, startedAt: at, note: /Queued:[^\n]*/i.exec(r.notes ?? '')?.[0]?.trim() ?? null };
    }

    const keys = extractJiraKeys(r.notes, r.branch, r.version, r.frontend_branch, r.backend_branch, r.ticket_link);
    if (!keys.length) {
      if (ok) unlinked++;
      continue;
    }
    if (!ok && /cancel|reject/i.test(r.status)) continue; // never ran: not a failure
    const state: EnvState = ok
      ? 'deployed'
      : /in progress/i.test(r.status)
        ? 'in_progress'
        : AWAITING_RE.test(r.status)
          ? 'awaiting_approval'
          : QUEUED_RE.test(r.status)
          ? 'queued'
          : /rolled back/i.test(r.status) || r.deployment_type === 'rollback'
          ? 'rolled_back'
          : 'failed';
    for (const key of keys) {
      const t = tickets.get(key) ?? { envs: new Map(), hotfix: false, latestAt: at };
      tickets.set(key, t);
      if (r.deployment_type === 'hotfix') t.hotfix = true;
      const cur = t.envs.get(r.environment);
      if (!cur) {
        t.envs.set(r.environment, {
          state,
          firstAt: at,
          lastAt: at,
          deploymentId: r.id,
          deploymentType: r.deployment_type,
          everDeployed: ok,
          versions: { frontend: r.frontend_version, backend: r.backend_version, single: r.version },
          deployedBy: r.deployed_by,
          runUrl: r.ticket_link && /^https?:\/\//.test(r.ticket_link) ? r.ticket_link : null,
        });
      } else if (ok) {
        // rows are newest first, so keep overwriting `firstAt` with the oldest success seen.
        // A newer failed/in-progress attempt keeps `state`, but the ticket still reached this env.
        cur.firstAt = at;
        cur.everDeployed = true;
      }
    }
  }

  // ---- Jira enrichment (optional) -------------------------------------------------------------
  let jiraError: string | null = null;
  const notInJira: string[] = [];
  const issues: Awaited<ReturnType<typeof jiraIssuesByKeys>> = {};
  const configured = jiraConfigured();
  if (opts.jira && configured && tickets.size) {
    try {
      const keys = [...tickets.entries()]
        .sort((a, b) => b[1].latestAt.localeCompare(a[1].latestAt))
        .slice(0, MAX_TICKETS)
        .map(([k]) => k);
      for (let i = 0; i < keys.length; i += 100) Object.assign(issues, await jiraIssuesByKeys(keys.slice(i, i + 100)));
      for (const k of keys) if (!issues[k]) notInJira.push(k);
    } catch (e) {
      jiraError = e instanceof Error ? e.message : 'Jira request failed';
    }
  }

  // ---- shape tickets --------------------------------------------------------------------------
  const out: PipelineTicket[] = [];
  const now = Date.now();
  for (const [key, t] of tickets) {
    const environments: Record<string, PipelineEnvEntry> = {};
    let best: { col: ColumnId; rank: number; at: string } | null = null;
    const reached = new Set<ColumnId>();
    for (const [env, e] of t.envs) {
      environments[env] = e;
      const m = envMeta.get(env)!;
      if (e.everDeployed || e.state === 'in_progress') {
        reached.add(m.col);
        if (!best || m.rank > best.rank || (m.rank === best.rank && e.lastAt > best.at)) best = { col: m.col, rank: m.rank, at: e.lastAt };
      }
    }
    if (!best) {
      // only failed / rolled-back attempts: show where they were attempted
      for (const [env, e] of t.envs) {
        const m = envMeta.get(env)!;
        if (!best || m.rank > best.rank) best = { col: m.col, rank: m.rank, at: e.lastAt };
      }
    }
    const jira = issues[key];
    const stage = jira ? stageOf(jira.status, jira.statusCategory) : null;
    const badges: PipelineTicket['badges'] = [];
    const states = [...t.envs.values()].map((e) => e.state);
    if (t.hotfix) badges.push({ id: 'hotfix' });
    if (states.includes('rolled_back')) badges.push({ id: 'rolled_back' });
    if (states.includes('failed')) badges.push({ id: 'failed' });
    if (jira && (stage === 'In Development' || stage === 'Review / QA')) {
      const idle = Math.floor((now - new Date(jira.updated).getTime()) / 86_400_000);
      if (idle >= 5) badges.push({ id: 'stuck' as BadgeId, days: idle });
    }
    out.push({
      key,
      summary: jira?.summary ?? null,
      type: jira?.type ?? null,
      priority: jira?.priority ?? null,
      status: jira?.status ?? null,
      stage,
      assignee: jira?.assignee ?? null,
      url: jira?.url ?? null,
      column: best!.col,
      reached: [...reached],
      environments,
      latestAt: t.latestAt,
      ageInStageDays: Math.max(0, Math.floor((now - new Date(best!.at).getTime()) / 86_400_000)),
      badges,
    });
  }
  out.sort((a, b) => b.latestAt.localeCompare(a.latestAt));
  const limited = out.slice(0, MAX_TICKETS);
  for (const t of limited) columns.get(t.column)!.ticketCount++;

  const oldest = okRes.rows.length ? iso(okRes.rows[okRes.rows.length - 1].started_at) : null;
  return {
    generatedAt: new Date().toISOString(),
    configured,
    jiraAuthorised: opts.jira && configured,
    jiraError,
    window: { deployments: okRes.rows.length, oldest, truncated: okRes.rows.length >= WINDOW },
    columns: [...columns.values()]
      .sort((a, b) => a.rank - b.rank || a._order - b._order)
      .map(({ _order, ...c }) => {
        void _order;
        return c;
      }),
    tickets: limited,
    unlinked: { deployments: unlinked },
    notInJira,
    truncated: out.length > limited.length,
  };
}
