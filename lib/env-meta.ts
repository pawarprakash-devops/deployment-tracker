// Self-registering environments: pure, client-safe helpers (no runtime imports, so `node --test` can load this file
// directly and client components can import it). Used by the webhook (tracker-block validation) and by every surface
// that maps an environment to a board column / group / rank.
//
// Contract: the vidai-devops deploy workflows add an optional `tracker` object to the webhook body (from the
// environment's clusters.json `tracker` block). Every field except `env` is optional; anything malformed is dropped,
// so a bad field can never stop the deployment from being recorded.

export const ENV_GROUPS = ['preview', 'demo', 'qa', 'stage', 'preprod', 'prod', 'lms', 'other'] as const;
export type EnvGroup = (typeof ENV_GROUPS)[number];

// Board column ids that existed before self-registration. They must keep their ids and ranks.
export const KNOWN_COLUMN_IDS = [
  'preview', 'demo', 'qa', 'stage', 'preprod', 'preprod-usw', 'preprod-egypt',
  'prod-ankura', 'prod-neotia', 'prod-usw', 'prod-egypt', 'other',
] as const;
export type KnownColumnId = (typeof KNOWN_COLUMN_IDS)[number];

export const COLUMN_NAMES: Record<string, string> = {
  preview: 'Preview',
  demo: 'Demo',
  qa: 'QA',
  stage: 'Stage',
  preprod: 'Pre-Prod',
  'preprod-usw': 'Pre-Prod · USW',
  'preprod-egypt': 'Pre-Prod · Egypt',
  'prod-ankura': 'Prod · Ankura',
  'prod-neotia': 'Prod · Neotia',
  'prod-usw': 'Prod · USW',
  'prod-egypt': 'Prod · Egypt',
  other: 'Other',
};

export const COLUMN_ID_RE = /^[a-z0-9-]{1,40}$/;

export interface TrackerMeta {
  env: string;
  production: boolean | null;
  group: EnvGroup | null;
  column: string | null;
  column_label: string | null;
  region: string | null;
  api_url: string | null;
  frontend_url: string | null;
  branch: string | null;
  promotes_from: string | null;
  order: number | null;
  cluster: string | null;
}

// Optional metadata columns on an `environments` row (null / absent until the env self-registers, or before the
// additive migration has run).
export interface EnvMetaRow {
  name: string;
  is_production?: boolean | null;
  display_order?: number | null;
  env_group?: string | null;
  column_id?: string | null;
  column_label?: string | null;
  region?: string | null;
  api_url?: string | null;
  frontend_url?: string | null;
  branch?: string | null;
  promotes_from?: string | null;
  cluster?: string | null;
  meta_updated_at?: string | Date | null;
}

const str = (v: unknown, max: number, re?: RegExp): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > max) return null;
  if (re && !re.test(s)) return null;
  return s;
};

const httpUrl = (v: unknown): string | null => {
  const s = str(v, 300);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? s : null;
  } catch {
    return null;
  }
};

const BRANCH_RE = /^[A-Za-z0-9._/-]+$/;
const REGION_RE = /^[a-z0-9-]+$/;
const CLUSTER_RE = /^[A-Za-z0-9._/:-]+$/;

export function isEnvGroup(v: unknown): v is EnvGroup {
  return typeof v === 'string' && (ENV_GROUPS as readonly string[]).includes(v);
}

/** Validate / sanitise the webhook `tracker` block. Returns null when absent or `env` is not a usable name. */
export function parseTrackerBlock(raw: unknown): TrackerMeta | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const t = raw as Record<string, unknown>;
  // environments.name was never widened to TEXT, so keep names short.
  const env = str(t.env, 100);
  if (!env) return null;
  const groupRaw = typeof t.group === 'string' ? t.group.trim().toLowerCase() : null;
  const group: EnvGroup | null = groupRaw ? (isEnvGroup(groupRaw) ? groupRaw : 'other') : null;
  const order = typeof t.order === 'number' && Number.isInteger(t.order) && Math.abs(t.order) <= 100_000 ? t.order : null;
  return {
    env,
    production: typeof t.production === 'boolean' ? t.production : null,
    group,
    column: str(t.column, 40, COLUMN_ID_RE),
    column_label: str(t.column_label, 60),
    region: str(t.region, 30, REGION_RE),
    api_url: httpUrl(t.api_url),
    frontend_url: httpUrl(t.frontend_url),
    branch: str(t.branch, 100, BRANCH_RE),
    promotes_from: str(t.promotes_from, 100, BRANCH_RE),
    order,
    cluster: str(t.cluster, 100, CLUSTER_RE),
  };
}

/** is_production for a tracker-registered env: explicit flag, else group 'prod', else the legacy name heuristic. */
export function trackerIsProduction(m: TrackerMeta): boolean {
  if (m.production !== null) return m.production;
  if (m.group) return m.group === 'prod';
  return /prod/i.test(m.env) && !/pre-?prod/i.test(m.env);
}

// ---- metadata ownership -------------------------------------------------------------------------
// Several clusters can deploy to the same environment (e.g. "Preview" is posted by the 99999 preview cluster, branch
// `dev`, AND by `ai-preview`, branch `ai`). Only ONE cluster owns an env's metadata, otherwise the probe URL / branch
// would flip with every deploy. Rule:
//  - environments.cluster is the owner (the clusters.json key). Once set, only a post whose tracker.cluster equals it
//    updates the metadata; any other cluster's deployment is still recorded under the env, metadata untouched.
//  - While the owner is NULL, the first post from a *primary* cluster claims it. A cluster is NOT primary when the env
//    has a known release branch (LEGACY_ENV_BRANCH) and tracker.branch is a different non-null branch: so ai-preview
//    (branch `ai`) can never claim Preview (`dev`), whichever deploys first after the migration. A null tracker.branch
//    does not contradict (Stage EUW2 / LMS / Refera send no branch).
//  - A post without tracker.cluster never claims an env and never updates an owned one.

/** Release branch per pre-existing env name. Fallback for compare, and the primary-cluster check above. */
export const LEGACY_ENV_BRANCH: Record<string, string> = {
  'Preview': 'dev', 'Demo-Preview': 'demo', 'QA': 'qa', 'Stage': 'stage', 'Stage EUW2': 'stage',
  'Pre-Prod': 'preprod', 'Pre-Prod (India)': 'preprod', 'Pre-Prod USW': 'preprod_usw', 'Pre-Prod Egypt': 'preprod_egypt',
  'Production (Ankura)': 'prod_ank', 'Production (Neotia)': 'prod_neo', 'Production (Neotia/Babyjoy)': 'prod_neo',
  'Production USW': 'prod_citmer', 'Production Egypt': 'prod_egypt', 'Production': 'prod_ank',
};

export type MetaDecision =
  | { apply: true; claim: boolean }
  | { apply: false; reason: 'no-cluster' | 'not-primary' | 'owned-by-other' };

/** May this tracker block write the env's metadata? `storedCluster` = environments.cluster (null = unowned). */
export function metaDecision(storedCluster: string | null | undefined, m: TrackerMeta): MetaDecision {
  if (!m.cluster) return { apply: false, reason: 'no-cluster' };
  if (storedCluster) return storedCluster === m.cluster ? { apply: true, claim: false } : { apply: false, reason: 'owned-by-other' };
  const legacy = LEGACY_ENV_BRANCH[m.env];
  if (legacy && m.branch && m.branch !== legacy) return { apply: false, reason: 'not-primary' };
  return { apply: true, claim: true };
}

// ---- board columns ------------------------------------------------------------------------------

/** Legacy name-based mapping (environments.name -> board column). Fallback when an env has no column_id. */
export function columnOf(env: string, isProduction: boolean): { id: KnownColumnId; rank: number } {
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
  // Egypt (eu-central-1): Pre-Prod Egypt is cut from Pre-Prod India (preprod -> preprod_egypt), same rank as USW.
  if (/^pre-?prod\b.*\b(egypt|euc)\b/.test(e)) return { id: 'preprod-egypt', rank: 3.5 };
  if (/^prod(uction)?\b.*\b(egypt|euc)\b/.test(e)) return { id: 'prod-egypt', rank: 4 };
  if (/^prod(uction)?\b.*\busw\b/.test(e)) return { id: 'prod-usw', rank: 4 };
  if (e.includes('citmer') && !/^pre[-_ ]?prod/.test(e)) return { id: 'prod-usw', rank: 4 };
  if (e.startsWith('pre-prod') || e.startsWith('preprod')) return { id: 'preprod', rank: 3 };
  if (e.includes('ankura')) return { id: 'prod-ankura', rank: 4 };
  if (e.includes('neotia') || e.includes('babyjoy')) return { id: 'prod-neotia', rank: 4 };
  return { id: 'other', rank: isProduction || /^production/i.test(env) ? 4 : 1 };
}

/** Group of a column id when no env_group is stored (known ids, plus the obvious prefixes). */
export function groupOfColumnId(id: string): EnvGroup {
  if (isEnvGroup(id)) return id;
  if (id.startsWith('preprod')) return 'preprod';
  if (id.startsWith('prod')) return 'prod';
  if (id.startsWith('stage')) return 'stage';
  if (id.startsWith('demo')) return 'demo';
  if (id.startsWith('qa')) return 'qa';
  if (id.startsWith('preview')) return 'preview';
  return 'other';
}

/** Board rank from the env group. Matches the legacy ranks for every pre-existing column. */
export function rankOf(group: EnvGroup, columnId: string, isProduction = false): number {
  switch (group) {
    case 'preview': return 0;
    case 'demo': case 'qa': return 1;
    case 'stage': return 2;
    case 'preprod': return columnId === 'preprod' ? 3 : 3.5;
    case 'prod': return 4;
    default: return isProduction ? 4 : 1; // lms / other (a production "other" column sat at 4 before)
  }
}

export interface ResolvedColumn { id: string; label: string; rank: number; group: EnvGroup; fromMeta: boolean }

/** Column for an environment: stored metadata first (column_id / column_label / env_group), legacy columnOf otherwise. */
export function resolveColumn(row: EnvMetaRow): ResolvedColumn {
  const prod = !!row.is_production;
  const cid = typeof row.column_id === 'string' && COLUMN_ID_RE.test(row.column_id) ? row.column_id : null;
  if (cid) {
    // The shared 'other' column (LMS, Production (Refera)) stays group 'other' as before, so a prod env parked there
    // does not light the Prod journey step; its rank still follows is_production (1, or 4 for production).
    const group: EnvGroup = cid === 'other' ? 'other' : isEnvGroup(row.env_group) ? row.env_group : groupOfColumnId(cid);
    const label = (typeof row.column_label === 'string' && row.column_label.trim()) || COLUMN_NAMES[cid] || cid;
    return { id: cid, label, rank: rankOf(group, cid, prod), group, fromMeta: true };
  }
  const c = columnOf(row.name, prod);
  const group: EnvGroup = c.id === 'other' ? 'other' : groupOfColumnId(c.id);
  return { id: c.id, label: COLUMN_NAMES[c.id], rank: c.rank, group, fromMeta: false };
}
