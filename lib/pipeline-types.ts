// Client-safe types for GET /api/pipeline (no server imports here).

// Board column id. Open-ended: self-registered environments bring their own (environments.column_id, kebab-case).
// The ids that existed before are listed in KNOWN_COLUMN_IDS (lib/env-meta.ts).
export type ColumnId = string;
export type EnvState = 'deployed' | 'in_progress' | 'queued' | 'awaiting_approval' | 'failed' | 'rolled_back';
export type BadgeId = 'hotfix' | 'rolled_back' | 'failed' | 'stuck';

export interface PipelineColumn {
  id: ColumnId;
  name: string;
  environments: string[];
  rank: number;
  // preview | demo | qa | stage | preprod | prod | lms | other (environments.env_group, else derived from the id).
  // Optional: older payloads omit it; use groupOfColumnId(id) from lib/env-meta.ts then.
  group?: string;
  isProduction: boolean;
  health: { lastSuccessAt: string | null; latest: { id: string; status: string; at: string } | null };
  activeDeploy: { id: string; status: string; startedAt: string } | null; // running now ('In Progress' only)
  // Newest 'Queued' deploy waiting behind a running one in the same cluster/component (not running yet). `note` = the row's
  // 'Queued: waiting for previous deployment run #N (position M)' text. Optional: older payloads omit it.
  queuedDeploy?: { id: string; status: string; startedAt: string; note: string | null } | null;
  queuedCount?: number;
  // Newest 'Awaiting approval' deploy (paused on a GitHub Environment approval; not running, holds no FIFO lane). Optional: older payloads omit it.
  awaitingDeploy?: { id: string; status: string; startedAt: string; note: string | null } | null;
  awaitingCount?: number;
  ticketCount: number;
}

export interface PipelineEnvEntry {
  state: EnvState;
  firstAt: string;
  lastAt: string;
  deploymentId: string;
  deploymentType: string | null;
  everDeployed: boolean; // at least one successful deploy to this env, even if a newer attempt failed
  versions: { frontend: string | null; backend: string | null; single: string | null };
  deployedBy: string | null;
  runUrl: string | null;
}

export interface PipelineTicket {
  key: string;
  // Jira fields: null when Jira is not configured / viewer is not authorised.
  summary: string | null;
  type: string | null;
  priority: string | null;
  status: string | null;
  stage: string | null;
  assignee: string | null;
  url: string | null;
  column: ColumnId;
  reached: ColumnId[];
  environments: Record<string, PipelineEnvEntry>;
  latestAt: string;
  ageInStageDays: number;
  badges: { id: BadgeId; days?: number }[];
}

export interface PipelineResponse {
  generatedAt: string;
  configured: boolean; // Jira configured on the server
  jiraAuthorised: boolean; // caller may see Jira fields
  jiraError: string | null;
  window: { deployments: number; oldest: string | null; truncated: boolean };
  columns: PipelineColumn[];
  tickets: PipelineTicket[];
  unlinked: { deployments: number };
  notInJira: string[];
  truncated: boolean;
}
