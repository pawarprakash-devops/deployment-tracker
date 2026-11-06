import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import type { EnvMetaRow } from '@/lib/env-meta';

export const dynamic = 'force-dynamic';

export interface ClusterTarget {
  name: string;
  env: string;
  url: string;
  type: 'backend' | 'frontend';
  timeoutMs?: number;
  region?: string | null;
}

export interface ProbeResult {
  environment: string;
  targetName: string;
  url: string;
  status: 'HEALTHY' | 'DEGRADED' | 'OFFLINE';
  statusCode: number | null;
  latencyMs: number;
  message: string;
  checkedAt: string;
  region?: string | null; // environments.region when the env self-registered (else absent: UI derives it from the host)
}

// Fallback endpoints. Environments that self-registered an api_url (deploy webhook `tracker` block) are probed from
// the environments table instead; a static entry is only used for an env with no api_url row (merged by env name).
const PROBE_TARGETS: ClusterTarget[] = [
  {
    name: 'Preview Backend API',
    env: 'Preview',
    url: 'https://99999.preview-api.vidaisolutions.com/api/',
    type: 'backend',
  },
  {
    name: 'Demo-Preview Backend API',
    env: 'Demo-Preview',
    url: 'https://preview-api.vidaisolutions.com/api/',
    type: 'backend',
  },
  {
    name: 'QA Backend API',
    env: 'QA',
    url: 'https://qa-aps-api.vidaisolutions.com/api/',
    type: 'backend',
  },
  {
    name: 'Stage Backend API',
    env: 'Stage',
    url: 'https://stage-api.vidaisolutions.com/api/',
    type: 'backend',
  },
  {
    name: 'Stage EUW2 Backend API',
    env: 'Stage EUW2',
    url: 'https://staging-euw2-api.vidaisolutions.com/api/',
    type: 'backend',
  },
  {
    name: 'Pre-Prod India Backend API',
    env: 'Pre-Prod',
    url: 'https://pre-api.vidaisolutions.com/api/',
    type: 'backend',
  },
  {
    name: 'Pre-Prod USW Backend API',
    env: 'Pre-Prod USW',
    url: 'https://pre-prod-usw-api.vidaisolutions.com/api/',
    type: 'backend',
  },
  {
    name: 'Pre-Prod Egypt Backend API',
    env: 'Pre-Prod Egypt',
    url: 'https://preprod-euc-api.vidaisolutions.com/api/',
    type: 'backend',
  },
  {
    // Prod account, us-west-1. Reports OFFLINE until the production-usw stack and DNS exist.
    name: 'Production USW Backend API',
    env: 'Production USW',
    url: 'https://production-usw-api.vidaisolutions.com/api/',
    type: 'backend',
  },
  {
    name: 'Prod Ankura Backend API',
    env: 'Production (Ankura)',
    url: 'https://production-api.vidaisolutions.com/api/',
    type: 'backend',
  },
  {
    name: 'Prod Neotia Backend API',
    env: 'Production (Neotia/Babyjoy)',
    url: 'https://production-aps-api.vidaisolutions.com/api/',
    type: 'backend',
  },
];

// environments.api_url (self-registered) first, then static targets for envs without one. Never throws: on a DB error or
// before /api/migrate has added the columns, the static list is used as-is. Each env and each URL is probed once.
async function probeTargets(): Promise<ClusterTarget[]> {
  let rows: EnvMetaRow[] = [];
  try {
    rows = (await pool.query<EnvMetaRow>('SELECT * FROM environments ORDER BY display_order, name')).rows;
  } catch (e) {
    console.warn('cluster-health: environments metadata unavailable, using static probes:', e instanceof Error ? e.message : e);
  }
  const out: ClusterTarget[] = [];
  const envs = new Set<string>();
  const urls = new Set<string>();
  for (const r of rows) {
    if (typeof r.api_url !== 'string' || !/^https?:\/\//i.test(r.api_url) || envs.has(r.name) || urls.has(r.api_url)) continue;
    out.push({ name: `${r.name} Backend API`, env: r.name, url: r.api_url, type: 'backend', region: r.region ?? null });
    envs.add(r.name); urls.add(r.api_url);
  }
  const regionOf = new Map(rows.map((r) => [r.name, r.region ?? null]));
  for (const t of PROBE_TARGETS) {
    if (envs.has(t.env) || urls.has(t.url)) continue;
    out.push({ ...t, region: regionOf.get(t.env) ?? null });
    envs.add(t.env); urls.add(t.url);
  }
  return out;
}

async function probeTarget(target: ClusterTarget): Promise<ProbeResult> {
  const start = Date.now();
  const checkedAt = new Date().toISOString();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), target.timeoutMs || 4500);

  try {
    const res = await fetch(target.url, {
      method: 'GET',
      headers: {
        'User-Agent': 'VidAI-ClusterHealthBot/1.0',
        'Accept': '*/*',
      },
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - start;

    if (res.status >= 200 && res.status < 400) {
      if (latencyMs > 2000) {
        return {
          environment: target.env,
          targetName: target.name,
          url: target.url,
          status: 'DEGRADED',
          statusCode: res.status,
          latencyMs,
          message: `Slow response: ${latencyMs}ms (>2000ms threshold)`,
          checkedAt,
        };
      }
      return {
        environment: target.env,
        targetName: target.name,
        url: target.url,
        status: 'HEALTHY',
        statusCode: res.status,
        latencyMs,
        message: `${res.status} OK`,
        checkedAt,
      };
    } else {
      return {
        environment: target.env,
        targetName: target.name,
        url: target.url,
        status: 'DEGRADED',
        statusCode: res.status,
        latencyMs,
        message: `HTTP ${res.status} ${res.statusText}`,
        checkedAt,
      };
    }
  } catch (error: any) {
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - start;
    const isTimeout = error.name === 'AbortError';

    return {
      environment: target.env,
      targetName: target.name,
      url: target.url,
      status: 'OFFLINE',
      statusCode: null,
      latencyMs,
      message: isTimeout ? 'Connection Timed Out (>4.5s)' : (error.message || 'Connection Refused / Network Error'),
      checkedAt,
    };
  }
}

export async function GET() {
  try {
    const targets = await probeTargets();
    const results = await Promise.all(targets.map(async (t) => {
      const r = await probeTarget(t);
      return t.region ? { ...r, region: t.region } : r;
    }));

    // Aggregate health by environment
    const byEnvironment: Record<string, ProbeResult> = {};
    for (const res of results) {
      byEnvironment[res.environment] = res;
      // Alias common synonyms in tracker
      if (res.environment === 'Pre-Prod') {
        byEnvironment['Pre-Prod (India)'] = res;
      }
      if (res.environment === 'Production (Ankura)') {
        byEnvironment['Production'] = res;
      }
      if (res.environment === 'Production (Neotia/Babyjoy)') {
        byEnvironment['Production (Neotia)'] = res;
      }
    }

    return NextResponse.json(
      {
        probed_at: new Date().toISOString(),
        total_probed: results.length,
        clusters: results,
        by_environment: byEnvironment,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300',
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error: any) {
    console.error('Error probing cluster health:', error);
    return NextResponse.json(
      { error: 'Failed to probe cluster health', details: error?.message },
      { status: 500 }
    );
  }
}
