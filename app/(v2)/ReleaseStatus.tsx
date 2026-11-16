'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  Clock,
  PauseCircle,
  ExternalLink,
  Activity,
} from 'lucide-react';
import { useShell } from './ctx';

interface Probe {
  environment: string;
  status: 'HEALTHY' | 'DEGRADED' | 'OFFLINE';
  latencyMs: number;
  url?: string;
}

interface SummaryData {
  latest?: { environment: string; status: string }[];
  queued?: number;
  awaiting_approval?: number;
}

export default function ReleaseStatus() {
  const { refreshKey, setEnvFilter } = useShell();
  const [probes, setProbes] = useState<Probe[] | null>(null);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const fetchData = async () => {
      try {
        const [probeRes, sumRes] = await Promise.all([
          fetch('/api/cluster-health', { cache: 'no-store' }),
          fetch('/api/summary', { cache: 'no-store' }),
        ]);

        if (probeRes.ok) {
          const pj = (await probeRes.json()) as { clusters?: Probe[] };
          if (alive && Array.isArray(pj.clusters)) setProbes(pj.clusters);
        }
        if (sumRes.ok) {
          const sj = (await sumRes.json()) as SummaryData;
          if (alive) setSummary(sj);
        }
        if (alive) setError(null);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Network error');
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 45_000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [refreshKey]);

  const issues = useMemo(() => {
    const list: { name: string; type: 'bad' | 'warn' | 'info'; message: string }[] = [];

    // Check cluster health probes
    if (probes) {
      for (const p of probes) {
        if (p.status === 'OFFLINE') {
          list.push({
            name: p.environment,
            type: 'bad',
            message: `Endpoint unreachable (${p.latencyMs}ms)`,
          });
        } else if (p.status === 'DEGRADED') {
          list.push({
            name: p.environment,
            type: 'warn',
            message: `High latency degraded response (${p.latencyMs}ms)`,
          });
        }
      }
    }

    // Check latest deployment status failures
    if (summary?.latest) {
      for (const item of summary.latest) {
        if (/fail/i.test(item.status)) {
          // If not already in issues
          if (!list.some((i) => i.name.toLowerCase() === item.environment.toLowerCase())) {
            list.push({
              name: item.environment,
              type: 'bad',
              message: `Latest deployment failed (${item.status})`,
            });
          }
        }
      }
    }

    return list;
  }, [probes, summary]);

  const hasIssues = issues.length > 0;
  const isHealthy = !hasIssues && probes && probes.length > 0;

  const scrollToEnv = (name: string) => {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const el = document.getElementById(`env-${slug}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      setEnvFilter(name);
    }
  };

  if (!probes && !summary && !error) {
    return (
      <div className="status-banner is-loading">
        <Loader2 size={15} className="spin text-muted" />
        <span>Checking environment fleet health &amp; active deployments...</span>
      </div>
    );
  }

  if (hasIssues) {
    const badCount = issues.filter((i) => i.type === 'bad').length;
    return (
      <div className={`status-banner ${badCount > 0 ? 'is-bad' : 'is-warn'}`}>
        <div className="status-banner-header">
          {badCount > 0 ? (
            <XCircle size={18} className="text-danger flex-none" />
          ) : (
            <AlertTriangle size={18} className="text-warn flex-none" />
          )}
          <span className="status-banner-title">
            {issues.length} {issues.length === 1 ? 'Environment Alert' : 'Environment Alerts'} Detected
          </span>
        </div>
        <div className="status-banner-chips">
          {issues.map((issue) => (
            <button
              key={issue.name}
              type="button"
              className={`status-issue-chip tone-${issue.type}`}
              onClick={() => scrollToEnv(issue.name)}
              title="Click to focus environment card"
            >
              <span className="issue-chip-name">{issue.name}:</span>
              <span className="issue-chip-msg">{issue.message}</span>
              <ExternalLink size={11} className="issue-chip-arrow" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="status-banner is-healthy">
      <div className="status-banner-left">
        <div className="healthy-indicator">
          <span className="healthy-pulse-ring" />
          <CheckCircle2 size={16} className="text-success" />
        </div>
        <div>
          <span className="status-healthy-title">All Systems Fully Operational</span>
          <span className="status-healthy-subtitle">
            {probes?.length ?? 0} environments monitored &amp; responsive · Zero active delivery blockers
          </span>
        </div>
      </div>

      <div className="status-banner-metrics">
        {summary?.awaiting_approval != null && summary.awaiting_approval > 0 && (
          <div className="status-metric-pill tone-info">
            <PauseCircle size={13} />
            <span>{summary.awaiting_approval} Awaiting Approval</span>
          </div>
        )}
        {summary?.queued != null && summary.queued > 0 && (
          <div className="status-metric-pill tone-warn">
            <Clock size={13} />
            <span>{summary.queued} Queued</span>
          </div>
        )}
        <div className="status-metric-pill tone-neutral">
          <Activity size={13} />
          <span>Fleet telemetry live</span>
        </div>
      </div>
    </div>
  );
}
