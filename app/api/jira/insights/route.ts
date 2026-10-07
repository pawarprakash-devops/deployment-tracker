import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import {
  cached, isAdminRequest, jiraConfigured, jiraCount, jiraSearch, jiraProjectStatuses, jqlStr, filterJql, stageOf, isDoneStage, isShipReady, JIRA_PROJECTS,
  ticketDeploys, isProdEnv, median, percentile, jiraIssuesByKeys, type JiraIssue,
} from '@/lib/jira';

export const dynamic = 'force-dynamic';
export const maxDuration = 30; // many Jira calls fan out in parallel; default is 10 s on Hobby

const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysSince = (s?: string | null) => (s ? Math.max(0, Math.floor((Date.now() - new Date(s).getTime()) / DAY)) : null);
const slim = (i: JiraIssue) => ({ ...i, ageDays: daysSince(i.updated), createdDays: daysSince(i.created) });

// GET /api/jira/insights?stuckDays=5  (admin session required)
export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Admin login required' }, { status: 401 });
  if (!jiraConfigured()) return NextResponse.json({ configured: false });
  if (!JIRA_PROJECTS.length) return NextResponse.json({ configured: true, error: 'Set JIRA_PROJECT_KEYS' }, { status: 400 });
  try {
    const stuckDays = Math.min(Math.max(parseInt(new URL(request.url).searchParams.get('stuckDays') || '5', 10) || 5, 1), 60);
    const filter = filterJql(new URL(request.url).searchParams);
    const fresh = new URL(request.url).searchParams.get('fresh') === '1'; // Refresh button bypasses the 5 min cache
    const payload = await cached(`insights:${stuckDays}:${filter.key}`, 300000, fresh, async () => {
    const proj = `project in (${JIRA_PROJECTS.join(',')})${filter.clause}`;
    const statuses = await jiraProjectStatuses(JIRA_PROJECTS);
    const names = (stage: string) => statuses.filter((s) => stageOf(s.name, s.category) === stage).map((s) => s.name);
    const inList = (ns: string[]) => ns.map(jqlStr).join(', ');
    const qaPassed = statuses.map((x) => x.name).filter(isShipReady), active = [...names('In Development'), ...names('Review / QA')], done = statuses.filter((x) => isDoneStage(stageOf(x.name, x.category))).map((x) => x.name);

    // Weekly bug flow, last 8 full weeks ending today (explicit dates so DURING is unambiguous)
    const weeks = Array.from({ length: 8 }, (_, k) => {
      const end = new Date(Date.now() - k * 7 * DAY), start = new Date(end.getTime() - 7 * DAY);
      return { start: iso(start), end: iso(end) };
    }).reverse();
    const closedClause = (a: string, b: string) =>
      done.length ? `(${done.map((n) => `status CHANGED TO ${jqlStr(n)} DURING (${jqlStr(a)}, ${jqlStr(b)})`).join(' OR ')})` : `resolved >= ${jqlStr(a)} AND resolved < ${jqlStr(b)}`;
    const ageBuckets: [string, string][] = [['< 7 days', 'created >= -7d'], ['7-30 days', 'created < -7d AND created >= -30d'], ['30-90 days', 'created < -30d AND created >= -90d'], ['> 90 days', 'created < -90d']];
    const priorities = ['Highest', 'High', 'Medium', 'Low', 'Lowest'];

    const [deploys, qaTotal, qaIssues, stuckTotal, stuckIssues, weekly, byPriority, byAge, doneIssues] = await Promise.all([
      ticketDeploys(pool).catch((e) => { console.error('ticketDeploys failed:', e?.message || e); return {} as Awaited<ReturnType<typeof ticketDeploys>>; }), // environments are optional; don't lose the whole report if the DB hiccups
      qaPassed.length ? jiraCount(`${proj} AND status in (${inList(qaPassed)})`) : 0,
      qaPassed.length ? jiraSearch(`${proj} AND status in (${inList(qaPassed)}) ORDER BY updated ASC`, 60) : [],
      active.length ? jiraCount(`${proj} AND status in (${inList(active)}) AND updated <= -${stuckDays}d`) : 0,
      active.length ? jiraSearch(`${proj} AND status in (${inList(active)}) AND updated <= -${stuckDays}d ORDER BY updated ASC`, 40) : [],
      Promise.all(weeks.map(async (w) => ({
        weekStart: w.start,
        created: await jiraCount(`${proj} AND type = Bug AND created >= ${jqlStr(w.start)} AND created < ${jqlStr(w.end)}`),
        closed: await jiraCount(`${proj} AND type = Bug AND ${closedClause(w.start, w.end)}`),
      }))),
      Promise.all(priorities.map(async (p) => ({ name: p, value: await jiraCount(`${proj} AND type = Bug AND statusCategory != Done AND priority = ${jqlStr(p)}`) }))),
      Promise.all(ageBuckets.map(async ([name, c]) => ({ name, value: await jiraCount(`${proj} AND type = Bug AND statusCategory != Done AND ${c}`) }))),
      jiraSearch(`${proj} AND statusCategory = Done AND statuscategorychangedate >= -90d ORDER BY statuscategorychangedate DESC`, 300),
    ]);

    // Ready-to-ship queue: QA-passed tickets, flagged with where they have been deployed
    const readyToShip = qaIssues.map((i) => {
      const envs = Object.keys(deploys[i.key] || {});
      return { ...slim(i), environments: envs, inProd: envs.some(isProdEnv) };
    });

    // Lead time (created -> done) for tickets that reached Done in the last 90 days
    const lead = (xs: JiraIssue[]) => {
      const d = xs.filter((i) => i.statusChanged).map((i) => (new Date(i.statusChanged!).getTime() - new Date(i.created).getTime()) / DAY).filter((x) => x >= 0);
      return { count: d.length, medianDays: +median(d).toFixed(1), p90Days: +percentile(d, 90).toFixed(1) };
    };
    // Sub-tasks (QA/Dev/DevOps/Demo) close within hours and would drown out real delivery time; epics are containers
    const leadIssues = doneIssues.filter((i) => !/sub-?task|epic/i.test(i.type));
    const byType: Record<string, JiraIssue[]> = {};
    for (const i of leadIssues) (byType[i.type] ??= []).push(i);

    // Ticket -> first Production deploy (needs the Jira created date of every ticket seen in prod)
    const prodKeys = Object.keys(deploys).filter((k) => Object.keys(deploys[k]).some(isProdEnv));
    let toProd = { count: 0, medianDays: 0, p90Days: 0 };
    if (prodKeys.length) {
      const issues = await jiraIssuesByKeys(prodKeys.slice(0, 100)).catch(() => ({} as Record<string, JiraIssue>));
      const d = prodKeys.flatMap((k) => {
        const i = issues[k]; if (!i) return [];
        const first = Object.entries(deploys[k]).filter(([e]) => isProdEnv(e)).map(([, v]) => v.first).sort()[0];
        const days = (new Date(first).getTime() - new Date(i.created).getTime()) / DAY;
        return days >= 0 ? [days] : [];
      });
      toProd = { count: d.length, medianDays: +median(d).toFixed(1), p90Days: +percentile(d, 90).toFixed(1) };
    }

    return {
      configured: true, stuckDays,
      readyToShip: { total: qaTotal, statuses: qaPassed, shownOldestFirst: readyToShip.length, notInProd: readyToShip.filter((i) => !i.inProd).length, items: readyToShip },
      stuck: { total: stuckTotal, statuses: active, items: stuckIssues.map(slim) },
      bugs: { weekly, byPriority: byPriority.filter((x) => x.value), byAge },
      leadTime: { overall: lead(leadIssues), byType: Object.fromEntries(Object.entries(byType).map(([t, xs]) => [t, lead(xs)])), createdToProd: toProd, windowDays: 90, sampled: leadIssues.length, excludedSubtasks: doneIssues.length - leadIssues.length },
    };
    });
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, max-age=300' } });
  } catch (e) {
    return NextResponse.json({ configured: true, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
