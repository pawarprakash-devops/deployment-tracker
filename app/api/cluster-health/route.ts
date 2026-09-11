import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export interface ClusterTarget {
  name: string;
  env: string;
  url: string;
  type: 'backend' | 'frontend';
  timeoutMs?: number;
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
}

// Configured endpoints based on VidAI infrastructure specification
const PROBE_TARGETS: ClusterTarget[] = [
  {
    name: 'Preview Backend API',
    env: 'Preview',
    url: 'https://99999.preview-api.vidaisolutions.com/api/',
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
    const results = await Promise.all(PROBE_TARGETS.map(probeTarget));

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
          'Cache-Control': 'no-store, no-cache, must-revalidate',
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
