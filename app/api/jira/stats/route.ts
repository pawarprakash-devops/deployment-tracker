import { NextRequest, NextResponse } from 'next/server';
import {
  cached, isAdminRequest, jiraConfigured, jiraCount, jiraSearch, jiraProjectStatuses, jiraActiveSprints,
  jqlStr, filterJql, stageOf, isDoneStage, STAGES, JIRA_PROJECTS,
} from '@/lib/jira';

export const dynamic = 'force-dynamic';
export const maxDuration = 30; // many Jira calls fan out in parallel; default is 10 s on Hobby

const toList = (o: Record<string, number>) =>
  Object.entries(o).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

// GET /api/jira/stats?days=30  (admin session required)
// Headline numbers use Jira's count endpoint over ALL issues of JIRA_PROJECT_KEYS (not a sample).
// Only the per-assignee breakdown is sampled (500 most recently updated open issues).
export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Admin login required' }, { status: 401 });
  if (!jiraConfigured()) return NextResponse.json({ configured: false });
  if (!JIRA_PROJECTS.length) {
    return NextResponse.json({ configured: true, error: 'Set JIRA_PROJECT_KEYS (e.g. VID) to enable metrics' }, { status: 400 });
  }
  try {
    const days = Math.min(Math.max(parseInt(new URL(request.url).searchParams.get('days') || '30', 10) || 30, 1), 90);
    const filter = filterJql(new URL(request.url).searchParams);
    const fresh = new URL(request.url).searchParams.get('fresh') === '1'; // Refresh button bypasses the 5 min cache
    const payload = await cached(`stats:${days}:${filter.key}`, 300000, fresh, async () => {
    const proj = `project in (${JIRA_PROJECTS.join(',')})${filter.clause}`;
    const statuses = await jiraProjectStatuses(JIRA_PROJECTS);
    const doneNames = statuses.filter((s) => isDoneStage(stageOf(s.name, s.category))).map((s) => s.name);
    const prodNames = statuses.filter((s) => stageOf(s.name, s.category) === 'Released to Prod').map((s) => s.name);
    const changedToDone = (d: number) =>
      doneNames.length ? `(${doneNames.map((n) => `status CHANGED TO ${jqlStr(n)} AFTER -${d}d`).join(' OR ')})` : 'resolved >= -' + d + 'd';

    const releasedWindow = prodNames.length ? jiraCount(`${proj} AND (${prodNames.map((n) => `status CHANGED TO ${jqlStr(n)} AFTER -${days}d`).join(' OR ')})`) : Promise.resolve(0);
    const [open, openBugs, created7, createdW, done7, doneW, released, perStatus, openBugList, sample, sprints] = await Promise.all([
      jiraCount(`${proj} AND statusCategory != Done`),
      jiraCount(`${proj} AND statusCategory != Done AND type = Bug`),
      jiraCount(`${proj} AND created >= -7d`),
      jiraCount(`${proj} AND created >= -${days}d`),
      jiraCount(`${proj} AND ${changedToDone(7)}`),
      jiraCount(`${proj} AND ${changedToDone(days)}`),
      prodNames.length ? jiraCount(`${proj} AND (${prodNames.map((n) => `status CHANGED TO ${jqlStr(n)} AFTER -${days}d`).join(' OR ')})`) : 0,
      Promise.all(statuses.map(async (s) => ({ ...s, count: await jiraCount(`${proj} AND status = ${jqlStr(s.name)}`) }))),
      jiraSearch(`${proj} AND statusCategory != Done AND type = Bug ORDER BY priority DESC, updated DESC`, 15),
      jiraSearch(`${proj} AND statusCategory != Done ORDER BY updated DESC`, 500),
      jiraActiveSprints(JIRA_PROJECTS[0]).catch((e) => ({ error: e instanceof Error ? e.message : String(e) })),
    ]);

    const byStageMap: Record<string, number> = {};
    const byStatusMap: Record<string, number> = {};
    for (const s of perStatus) {
      if (!s.count) continue;
      byStatusMap[s.name] = s.count;
      const st = stageOf(s.name, s.category);
      byStageMap[st] = (byStageMap[st] || 0) + s.count;
    }
    const byStage = STAGES.filter((n) => byStageMap[n]).map((n) => ({ name: n, value: byStageMap[n] }));
    const assignee: Record<string, number> = {};
    for (const i of sample) assignee[i.assignee || 'Unassigned'] = (assignee[i.assignee || 'Unassigned'] || 0) + 1;

    return {
      configured: true,
      projects: JIRA_PROJECTS,
      windowDays: days,
      totals: {
        open, openBugs,
        inDevelopment: byStageMap['In Development'] || 0,
        inQA: (byStageMap['Review / QA'] || 0) + (byStageMap['QA Passed'] || 0),
        createdLast7d: created7, createdInWindow: createdW,
        doneLast7d: done7, doneInWindow: doneW, releasedInWindow: released,
      },
      doneStatuses: doneNames,
      byStage,
      byStatus: toList(byStatusMap).filter((x) => x.value > 0),
      byAssignee: toList(assignee),
      assigneeSampled: sample.length,
      openBugs: openBugList,
      sprints: Array.isArray(sprints) ? sprints : [],
      sprintError: Array.isArray(sprints) ? undefined : sprints.error,
    };
    });
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, max-age=300' } });
  } catch (e) {
    return NextResponse.json({ configured: true, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
