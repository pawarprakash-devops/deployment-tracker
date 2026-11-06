// Run: npm test   (node --test, with tests/ts-loader.mjs transpiling lib/env-meta.ts via the typescript devDependency)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTrackerBlock, trackerIsProduction, resolveColumn, columnOf, rankOf, groupOfColumnId, metaDecision } from '../lib/env-meta.ts';

const egypt = {
  env: 'Pre-Prod Egypt', production: false, group: 'preprod', column: 'preprod-egypt', column_label: 'Pre-Prod · Egypt',
  region: 'eu-central-1', api_url: 'https://preprod-euc-api.vidaisolutions.com/api/', frontend_url: 'https://preprod-euc.vidaisolutions.com',
  branch: 'preprod_egypt', promotes_from: 'preprod', order: 5, cluster: 'preprod-euc-ecs-cluster',
};

test('valid block (Egypt example) is kept verbatim', () => {
  assert.deepEqual(parseTrackerBlock(egypt), egypt);
  assert.equal(trackerIsProduction(parseTrackerBlock(egypt)), false);
});

test('Egypt example resolves to the preprod-egypt column at rank 3.5', () => {
  const m = parseTrackerBlock(egypt);
  const c = resolveColumn({ name: m.env, is_production: false, env_group: m.group, column_id: m.column, column_label: m.column_label });
  assert.deepEqual(c, { id: 'preprod-egypt', label: 'Pre-Prod · Egypt', rank: 3.5, group: 'preprod', fromMeta: true });
  const p = resolveColumn({ name: 'Production Egypt', is_production: true, env_group: 'prod', column_id: 'prod-egypt', column_label: 'Prod · Egypt' });
  assert.equal(p.rank, 4);
});

test('absent / unusable block -> null (webhook falls back to normalizeEnvironment)', () => {
  for (const v of [undefined, null, 'x', 42, [], {}, { env: '' }, { env: '   ' }, { env: 7 }, { env: 'x'.repeat(101) }]) {
    assert.equal(parseTrackerBlock(v), null, JSON.stringify(v));
  }
});

test('only env given: everything else null', () => {
  const m = parseTrackerBlock({ env: 'New Env' });
  assert.equal(m.env, 'New Env');
  for (const k of ['production', 'group', 'column', 'column_label', 'region', 'api_url', 'frontend_url', 'branch', 'promotes_from', 'order', 'cluster']) {
    assert.equal(m[k], null, k);
  }
});

test('garbage fields are dropped, env survives', () => {
  const m = parseTrackerBlock({
    env: ' Stage X ', production: 'yes', group: 42, column_label: 'L'.repeat(61), region: 'EU Central', api_url: 'javascript:alert(1)',
    frontend_url: 'not a url', branch: 'bad branch; rm', promotes_from: {}, order: 2.5, cluster: ['x'],
  });
  assert.equal(m.env, 'Stage X');
  assert.deepEqual({ ...m, env: undefined }, {
    env: undefined, production: null, group: null, column: null, column_label: null, region: null, api_url: null,
    frontend_url: null, branch: null, promotes_from: null, order: null, cluster: null,
  });
  assert.equal(parseTrackerBlock({ env: 'a', order: Infinity }).order, null);
  assert.equal(parseTrackerBlock({ env: 'a', order: '5' }).order, null);
  assert.equal(parseTrackerBlock({ env: 'a', api_url: 'ftp://x/' }).api_url, null);
});

test('unknown group -> other; group is case-insensitive', () => {
  assert.equal(parseTrackerBlock({ env: 'a', group: 'sandbox' }).group, 'other');
  assert.equal(parseTrackerBlock({ env: 'a', group: 'PROD' }).group, 'prod');
});

test('bad column id -> null -> legacy name mapping', () => {
  for (const col of ['Pre Prod', 'UPPER', 'a_b', 'x'.repeat(41), '', 'egypt/../x']) {
    assert.equal(parseTrackerBlock({ env: 'a', column: col }).column, null, col);
  }
  const c = resolveColumn({ name: 'Pre-Prod USW', column_id: 'Bad Id', env_group: 'preprod' });
  assert.deepEqual(c, { id: 'preprod-usw', label: 'Pre-Prod · USW', rank: 3.5, group: 'preprod', fromMeta: false });
});

test('production flag: explicit, then group, then name heuristic', () => {
  assert.equal(trackerIsProduction(parseTrackerBlock({ env: 'Pre-Prod Y', production: true })), true);
  assert.equal(trackerIsProduction(parseTrackerBlock({ env: 'Production Z', group: 'preprod' })), false);
  assert.equal(trackerIsProduction(parseTrackerBlock({ env: 'Foo', group: 'prod' })), true);
  assert.equal(trackerIsProduction(parseTrackerBlock({ env: 'Production Z' })), true);
  assert.equal(trackerIsProduction(parseTrackerBlock({ env: 'Pre-Prod Z' })), false);
});

// Every pre-existing column: [env name, is_production, column id, legacy rank, group]
const EXISTING = [
  ['Preview', false, 'preview', 0, 'preview'],
  ['Demo-Preview', false, 'demo', 1, 'demo'],
  ['QA', false, 'qa', 1, 'qa'],
  ['Stage', false, 'stage', 2, 'stage'],
  ['Stage EUW2', false, 'stage', 2, 'stage'],
  ['Pre-Prod', false, 'preprod', 3, 'preprod'],
  ['Pre-Prod USW', false, 'preprod-usw', 3.5, 'preprod'],
  ['Pre-Prod Egypt', false, 'preprod-egypt', 3.5, 'preprod'],
  ['Production (Ankura)', true, 'prod-ankura', 4, 'prod'],
  ['Production (Neotia/Babyjoy)', true, 'prod-neotia', 4, 'prod'],
  ['Production USW', true, 'prod-usw', 4, 'prod'],
  ['Production Egypt', true, 'prod-egypt', 4, 'prod'],
];

test('existing column ids keep today\'s ranks, with and without metadata', () => {
  for (const [name, prod, id, rank, group] of EXISTING) {
    assert.deepEqual(columnOf(name, prod), { id, rank }, `legacy ${name}`);
    const legacy = resolveColumn({ name, is_production: prod });
    assert.deepEqual([legacy.id, legacy.rank, legacy.group, legacy.fromMeta], [id, rank, group, false], `fallback ${name}`);
    const meta = resolveColumn({ name, is_production: prod, column_id: id, env_group: group });
    assert.deepEqual([meta.id, meta.rank, meta.group, meta.fromMeta], [id, rank, group, true], `meta ${name}`);
    // column id alone (no group) derives the same group/rank
    assert.equal(resolveColumn({ name, is_production: prod, column_id: id }).rank, rank, `id-only ${name}`);
    assert.equal(groupOfColumnId(id), group);
  }
});

test('other / lms ranks', () => {
  assert.deepEqual(columnOf('LMS', false), { id: 'other', rank: 1 });
  assert.deepEqual(columnOf('Production (Refera)', true), { id: 'other', rank: 4 });
  assert.equal(resolveColumn({ name: 'LMS' }).group, 'other');
  assert.equal(rankOf('lms', 'lms', false), 1);
  assert.equal(rankOf('other', 'x', true), 4);
  // label fallback: unknown id without label shows the id
  assert.equal(resolveColumn({ name: 'X', column_id: 'qa-eu', env_group: 'qa' }).label, 'qa-eu');
});

// ---- shared env / cluster ownership (Preview is posted by the 99999 preview cluster AND ai-preview) ----
const preview99999 = parseTrackerBlock({ env: 'Preview', group: 'preview', column: 'preview', branch: 'dev', cluster: 'vidai-solutions-preview-99999', api_url: 'https://99999.preview-api.vidaisolutions.com/api/' });
const aiPreview = parseTrackerBlock({ env: 'Preview', group: 'preview', column: 'preview', branch: 'ai', cluster: 'ai-preview', api_url: 'https://ai-preview-api.example.com/api/' });

test('first primary cluster claims an unowned env; the owner keeps updating it', () => {
  assert.deepEqual(metaDecision(null, preview99999), { apply: true, claim: true });
  assert.deepEqual(metaDecision(undefined, preview99999), { apply: true, claim: true });
  assert.deepEqual(metaDecision('vidai-solutions-preview-99999', preview99999), { apply: true, claim: false });
});

test('a different cluster never changes an owned env (deployment is still recorded by the webhook)', () => {
  assert.deepEqual(metaDecision('vidai-solutions-preview-99999', aiPreview), { apply: false, reason: 'owned-by-other' });
});

test('ai-preview cannot claim Preview even if it deploys first after the migration', () => {
  assert.deepEqual(metaDecision(null, aiPreview), { apply: false, reason: 'not-primary' });
  // ...and the real owner still claims it afterwards
  assert.deepEqual(metaDecision(null, preview99999), { apply: true, claim: true });
});

test('no tracker.cluster: never claims, never updates', () => {
  const m = parseTrackerBlock({ env: 'Preview', branch: 'dev' });
  assert.deepEqual(metaDecision(null, m), { apply: false, reason: 'no-cluster' });
  assert.deepEqual(metaDecision('x', m), { apply: false, reason: 'no-cluster' });
});

test('null branch does not contradict the legacy branch (Stage EUW2, LMS, Refera); new envs are claimed by the first cluster', () => {
  assert.deepEqual(metaDecision(null, parseTrackerBlock({ env: 'Stage EUW2', branch: null, cluster: 'staging-euw2' })), { apply: true, claim: true });
  assert.deepEqual(metaDecision(null, parseTrackerBlock({ env: 'LMS', branch: null, promotes_from: null, cluster: 'lms' })), { apply: true, claim: true });
  assert.deepEqual(metaDecision(null, parseTrackerBlock({ env: 'Brand New', branch: 'whatever', cluster: 'new-1' })), { apply: true, claim: true });
});

test('null branch / promotes_from parse to null (the webhook COALESCEs, so null never overwrites)', () => {
  const m = parseTrackerBlock({ env: 'Production (Refera)', branch: null, promotes_from: null, cluster: 'prod-refera' });
  assert.equal(m.branch, null);
  assert.equal(m.promotes_from, null);
});

test('LMS / Production (Refera) on column "other" keep today\'s ranks', () => {
  const lms = parseTrackerBlock({ env: 'LMS', production: false, group: 'lms', column: 'other', column_label: 'Other', cluster: 'lms' });
  const refera = parseTrackerBlock({ env: 'Production (Refera)', production: true, group: 'prod', column: 'other', column_label: 'Other', order: 11, cluster: 'prod-refera' });
  const l = resolveColumn({ name: lms.env, is_production: false, env_group: lms.group, column_id: lms.column, column_label: lms.column_label });
  assert.deepEqual([l.id, l.label, l.rank], ['other', 'Other', 1]);
  assert.equal(columnOf('LMS', false).rank, l.rank);
  const r = resolveColumn({ name: refera.env, is_production: true, env_group: refera.group, column_id: refera.column, column_label: refera.column_label });
  assert.deepEqual([r.id, r.label, r.rank, r.group], ['other', 'Other', 4, 'other']);
  assert.equal(columnOf('Production (Refera)', true).rank, r.rank);
  assert.equal(refera.order, 11);
});
