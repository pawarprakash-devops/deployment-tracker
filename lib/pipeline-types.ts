// Client-safe types for GET /api/pipeline (no server imports here).

export type ColumnId = 'preview' | 'demo' | 'qa' | 'stage' | 'preprod' | 'prod-ankura' | 'prod-neotia' | 'other';
export type EnvState = 'deployed' | 'in_progress' | 'queued' | 'failed' | 'rolled_back';
export type BadgeId = 'hotfix' | 'rolled_back' | 'failed' | 'stuck';

export interface PipelineColumn {
  id: ColumnId;
  name: string;
  environments: string[];
  rank: number;
  isProduction: boolean;
  health: { lastSuccessAt: string | null; latest: { id: string; status: string; at: string } | null };
  activeDeploy: { id: string; status: string; startedAt: string } | null; // running now ('In Progress' only)
  // Newest 'Queued' deploy waiting behind a running one in the same cluster/component (not running yet). `note` = the row's
  // 'Queued: waiting for previous deployment run #N (position M)' text. Optional: older payloads omit it.
  queuedDeploy?: { id: string; status: string; startedAt: string; note: string | null } | null;
  queuedCount?: number;
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
