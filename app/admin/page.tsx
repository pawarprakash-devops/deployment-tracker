'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface FailureRecord {
  environment: string;
  branch: string | null;
  started_at: string;
  notes: string | null;
}

interface SlowestRecord {
  environment: string;
  duration_seconds: number;
  started_at: string;
  branch: string | null;
}

interface DoraMetric {
  value: string;
  rating: 'Elite' | 'High' | 'Medium' | 'Low';
  target: string;
  status: 'OPTIMAL' | 'ACCEPTABLE' | 'ATTENTION';
  [key: string]: any;
}

interface RecoveryIncident {
  environment: string;
  failedAt: string;
  recoveredAt: string;
  failedRunLink: string | null;
  recoveredRunLink: string | null;
  failedAuthor: string | null;
  recoveredAuthor: string | null;
  durationMinutes: number;
}

interface DoraSuite {
  deploymentFrequency: DoraMetric & { dailyAverage: number; todayCount: number; weekCount: number };
  leadTimeForChanges: DoraMetric & { hours: number };
  changeFailureRate: DoraMetric & { rate: number; prodRate: number; failedCount: number; totalCount: number };
  meanTimeToRecovery: DoraMetric & { minutes: number; medianMinutes: number; averageMinutes: number; totalRecovered: number };
  overallScore: { tier: 'Elite' | 'High' | 'Medium' | 'Low'; eliteCount: number; highCount: number; summary: string };
  recentRecoveries: RecoveryIncident[];
}

interface Stats {
  totalDeployments: number;
  successRate: number;
  failureRate: number;
  avgDuration: number;
  deploymentsToday: number;
  deploymentsThisWeek: number;
  byEnvironment: Record<string, number>;
  byStatus: Record<string, number>;
  recentFailures: FailureRecord[];
  slowestDeployments: SlowestRecord[];
  mostActiveUsers: Record<string, number>;
  dora?: DoraSuite;
}

const ENV_CLUSTER_MAP: Record<string, { region: string; clusterShort: string; type: string }> = {
  'Preview': { region: 'ap-south-1', clusterShort: 'preview-99999', type: 'Fargate' },
  'QA': { region: 'ap-south-1', clusterShort: 'qa-aps-ecs', type: 'ECS' },
  'Stage': { region: 'ap-south-1', clusterShort: 'stage-aps-ecs', type: 'ECS' },
  'Stage EUW2': { region: 'eu-west-2', clusterShort: 'staging-euw2', type: 'ECS' },
  'Pre-Prod': { region: 'ap-south-1', clusterShort: 'pre-prod-ecs', type: 'ECS' },
  'Pre-Prod (India)': { region: 'ap-south-1', clusterShort: 'pre-prod-ecs', type: 'ECS' },
  'Pre-Prod USW': { region: 'us-west-2', clusterShort: 'pre-prod-usw', type: 'ECS' },
  'Production (Ankura)': { region: 'ap-south-1', clusterShort: 'vidai-prod', type: 'PROD' },
  'Production (Neotia)': { region: 'ap-south-1', clusterShort: 'prod-aps', type: 'PROD' },
  'Production (Neotia/Babyjoy)': { region: 'ap-south-1', clusterShort: 'prod-aps', type: 'PROD' },
  'Production': { region: 'ap-south-1', clusterShort: 'vidai-prod', type: 'PROD' },
  'LMS': { region: 'ap-south-1', clusterShort: 'lms-aps-ecs', type: 'ECS' },
};

export default function AdminDashboard() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);

  // In-page Login State
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  useEffect(() => {
    checkAuth();
    const interval = setInterval(() => {
      if (isAdmin) {
        loadStats(true);
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [isAdmin]);

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/auth/session');
      const data = await res.json();

      if (!data.authenticated) {
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      setIsAdmin(true);
      await loadStats();
    } catch (error) {
      console.error('Auth verification error:', error);
      setIsAdmin(false);
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async (isBackground = false) => {
    if (!isBackground) setIsRefreshing(true);
    try {
      const res = await fetch('/api/admin/stats');
      if (res.ok) {
        const data = await res.json();
        setStats(data);
        setLastUpdated(new Date());
      } else if (res.status === 401) {
        setIsAdmin(false);
      }
    } catch (error) {
      console.error('Failed to load stats:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoggingIn(true);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      if (res.ok) {
        setIsAdmin(true);
        setPassword('');
        await loadStats();
      } else {
        setLoginError('ERR_AUTH_FAILED: Invalid operator token.');
      }
    } catch (err) {
      setLoginError('ERR_CONN_TIMEOUT: Authorization service unavailable.');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth', { method: 'DELETE' });
      setIsAdmin(false);
      setStats(null);
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  const timeAgo = (isoDate: string) => {
    if (!isoDate) return '—';
    const diff = (Date.now() - new Date(isoDate).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  const formatSeconds = (seconds: number) => {
    if (!seconds) return '0s';
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    if (mins === 0) return `${secs}s`;
    return `${mins}m ${secs}s`;
  };

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="cyber-spinner" />
        <div className="loading-text">PROBING FLEET TELEMETRY &amp; OPERATOR AUDIT...</div>
        <style jsx>{`
          .loading-screen {
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background: #07090E;
            color: #00F0FF;
            font-family: 'JetBrains Mono', monospace;
            gap: 18px;
          }
          .cyber-spinner {
            width: 44px;
            height: 44px;
            border: 3px solid rgba(0, 240, 255, 0.2);
            border-top-color: #00F0FF;
            border-radius: 50%;
            animation: spin 1s linear infinite;
          }
          .loading-text {
            font-size: 13px;
            letter-spacing: 0.08em;
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  // If Not Authenticated, show DevOps Authentication Challenge Gateway
  if (!isAdmin) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <div className="terminal-bar">
            <div className="dots">
              <span className="dot red" />
              <span className="dot yellow" />
              <span className="dot green" />
            </div>
            <span className="meta">auth::security-challenge · root-l3</span>
          </div>

          <div className="auth-body">
            <div className="cli-line">
              <span className="cli-host">vidai@devops-core</span>
              <span className="cli-sep">:</span>
              <span className="cli-path">~/security</span>
              <span className="cli-cmd"> # ./authenticate-operator --elevated</span>
            </div>

            <h2>SECURITY CLEARANCE REQUIRED</h2>
            <p className="auth-sub">
              Access to cluster analytics, error rates, and operator telemetry requires elevated credentials.
            </p>

            <form onSubmit={handleLogin} className="auth-form">
              <div className="input-field">
                <label>OPERATOR ACCESS TOKEN</label>
                <input
                  type="password"
                  placeholder="Enter administrator token..."
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              {loginError && <div className="error-badge">{loginError}</div>}

              <div className="auth-actions">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => router.push('/')}
                >
                  ← RETURN TO RADAR
                </button>
                <button
                  type="submit"
                  className="btn primary"
                  disabled={loggingIn}
                >
                  {loggingIn ? 'VERIFYING...' : 'AUTHORIZE SESSION ➔'}
                </button>
              </div>
            </form>
          </div>
        </div>

        <style jsx>{`
          .auth-wrap {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background-color: #07090E;
            background-image:
              radial-gradient(ellipse 80% 50% at 50% -20%, rgba(0, 240, 255, 0.08), transparent),
              linear-gradient(rgba(33, 38, 45, 0.28) 1px, transparent 1px),
              linear-gradient(90deg, rgba(33, 38, 45, 0.28) 1px, transparent 1px);
            background-size: 100% 100%, 32px 32px, 32px 32px;
            padding: 24px;
            color: #E6EDF3;
            font-family: 'JetBrains Mono', monospace;
          }
          .auth-card {
            background: rgba(13, 17, 23, 0.9);
            border: 1px solid rgba(0, 240, 255, 0.3);
            border-radius: 12px;
            width: 100%;
            max-width: 520px;
            overflow: hidden;
            box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6), 0 0 24px rgba(0, 240, 255, 0.12);
          }
          .terminal-bar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 14px;
            background: rgba(22, 27, 34, 0.9);
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          }
          .dots { display: flex; gap: 5px; }
          .dot { width: 8px; height: 8px; border-radius: 50%; }
          .dot.red { background: #FF5F56; }
          .dot.yellow { background: #FFBD2E; }
          .dot.green { background: #27C93F; }
          .meta { font-size: 11px; color: #8B949E; }
          .auth-body { padding: 28px 24px; }
          .cli-line {
            font-size: 11px;
            background: rgba(0, 0, 0, 0.5);
            border: 1px solid rgba(255, 255, 255, 0.06);
            padding: 6px 10px;
            border-radius: 6px;
            margin-bottom: 16px;
          }
          .cli-host { color: #00F0FF; font-weight: 700; }
          .cli-sep { color: #484F58; }
          .cli-path { color: #F59E0B; }
          .cli-cmd { color: #8B949E; }
          h2 {
            font-family: 'Space Grotesk', sans-serif;
            font-size: 18px;
            font-weight: 700;
            letter-spacing: 0.04em;
            margin: 0 0 8px;
            color: #E6EDF3;
          }
          .auth-sub {
            font-size: 12px;
            color: #8B949E;
            line-height: 1.5;
            margin: 0 0 24px;
          }
          .input-field { display: flex; flex-direction: column; gap: 8px; margin-bottom: 18px; }
          .input-field label { font-size: 11px; font-weight: 700; color: #8B949E; letter-spacing: 0.05em; }
          .input-field input {
            background: #161B22;
            border: 1px solid #30363D;
            color: #E6EDF3;
            padding: 11px 14px;
            border-radius: 6px;
            font-size: 13px;
            font-family: 'JetBrains Mono', monospace;
            outline: none;
            transition: all 0.2s;
          }
          .input-field input:focus {
            border-color: #00F0FF;
            box-shadow: 0 0 10px rgba(0, 240, 255, 0.25);
          }
          .error-badge {
            background: rgba(255, 51, 102, 0.12);
            border: 1px solid rgba(255, 51, 102, 0.3);
            color: #FF3366;
            font-size: 11px;
            padding: 8px 12px;
            border-radius: 6px;
            margin-bottom: 18px;
          }
          .auth-actions { display: flex; justify-content: space-between; gap: 12px; }
          .btn {
            padding: 9px 16px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 700;
            font-family: 'JetBrains Mono', monospace;
            cursor: pointer;
            transition: all 0.2s;
            display: inline-flex;
            align-items: center;
          }
          .btn.primary {
            background: #00F0FF;
            border: 1px solid #00F0FF;
            color: #07090E;
            box-shadow: 0 0 12px rgba(0, 240, 255, 0.25);
          }
          .btn.primary:hover:not(:disabled) {
            opacity: 0.9;
            box-shadow: 0 0 18px rgba(0, 240, 255, 0.45);
          }
          .btn.primary:disabled { opacity: 0.6; cursor: not-allowed; }
          .btn.ghost {
            background: transparent;
            border: 1px solid #30363D;
            color: #8B949E;
          }
          .btn.ghost:hover {
            border-color: #00F0FF;
            color: #00F0FF;
          }
        `}</style>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="admin-page">
      {/* Top CLI & Command Center Header */}
      <header className="top-header">
        <div className="title-section">
          <div className="terminal-cli-bar">
            <span className="cli-prefix">$</span>
            <span className="cli-host">vidai@devops-core</span>
            <span className="cli-sep">:</span>
            <span className="cli-path">~/telemetry</span>
            <span className="cli-git"> (git:main)</span>
            <span className="cli-cmd"> # deployment-tracker --admin-analytics --realtime</span>
          </div>
          <h1>FLEET TELEMETRY &amp; AUDIT ENGINE</h1>
          <div className="sub-line">
            <span className={`live-dot ${isRefreshing ? 'refreshing' : ''}`}>●</span>
            <span className="sys-badge">OPERATOR LEVEL 3</span>
            <span>POLL: 60s</span>
            <span>·</span>
            <span>LAST AUDIT: {lastUpdated.toLocaleTimeString()}</span>
            <span>·</span>
            <span>DATA SCOPE: FULL INFRASTRUCTURE</span>
          </div>
        </div>

        <div className="action-buttons">
          <button className="btn ghost" onClick={() => router.push('/')}>
            ← RETURN TO RADAR
          </button>
          <a href="/copilot" className="copilot-pill">
            ⚡ COPILOT METRICS ➔
          </a>
          <button className="btn ghost" onClick={() => loadStats()}>
            🔄 REFRESH
          </button>
          <button className="btn danger" onClick={handleLogout}>
            ⎋ LOGOUT
          </button>
        </div>
      </header>

      {/* 6-Card DevOps HUD Telemetry Bar */}
      <div className="hud-grid">
        <div className="hud-card">
          <div className="hud-stripe" style={{ background: '#00F0FF' }} />
          <span className="hud-label">TOTAL RUNS</span>
          <div className="hud-value accent">{stats.totalDeployments}</div>
          <span className="hud-sub">All logged pipelines</span>
        </div>

        <div className="hud-card">
          <div className="hud-stripe" style={{ background: '#00FF9D' }} />
          <span className="hud-label">FLEET SUCCESS RATE</span>
          <div className="hud-value ok">
            <span className="dot-pulse ok" />
            {stats.successRate.toFixed(1)}%
          </div>
          <span className="hud-sub">Optimal target &gt; 95%</span>
        </div>

        <div className="hud-card">
          <div className="hud-stripe" style={{ background: '#FF3366' }} />
          <span className="hud-label">INCIDENT RATE</span>
          <div className="hud-value bad">{stats.failureRate.toFixed(1)}%</div>
          <span className="hud-sub">Failed pipeline runs</span>
        </div>

        <div className="hud-card">
          <div className="hud-stripe" style={{ background: '#F59E0B' }} />
          <span className="hud-label">AVG RUNTIME (PIPELINE)</span>
          <div className="hud-value warn">{formatSeconds(stats.avgDuration)}</div>
          <span className="hud-sub">Average runtime</span>
        </div>

        <div className="hud-card">
          <div className="hud-stripe" style={{ background: '#38BDF8' }} />
          <span className="hud-label">TODAY&apos;S VELOCITY</span>
          <div className="hud-value sky">{stats.deploymentsToday} DEPLOYS</div>
          <span className="hud-sub">Deploys executed today</span>
        </div>

        <div className="hud-card">
          <div className="hud-stripe" style={{ background: '#FF4500' }} />
          <span className="hud-label">7-DAY THROUGHPUT</span>
          <div className="hud-value prod">{stats.deploymentsThisWeek} RUNS</div>
          <span className="hud-sub">Rolling 7-day activity</span>
        </div>
      </div>

      {/* DORA Metrics Suite */}
      {stats.dora && (
        <section className="dora-section">
          <div className="dora-header">
            <div className="dora-header-left">
              <div className="dora-title-group">
                <span className="dora-glow-badge">DORA FRAMEWORK v2026</span>
                <h2 className="dora-title">DEVOPS RESEARCH &amp; ASSESSMENT (DORA) SUITE</h2>
              </div>
              <p className="dora-subtitle">
                Automated continuous measurement of delivery velocity and system recovery stability computed from production &amp; lower environments.
              </p>
            </div>
            <div className="dora-header-right">
              <div className={`dora-overall-badge ${stats.dora.overallScore.tier.toLowerCase()}`}>
                <span className="tier-light" />
                <div className="tier-content">
                  <span className="tier-label">OVERALL MATURITY</span>
                  <span className="tier-val">{stats.dora.overallScore.tier.toUpperCase()} PERFORMER</span>
                </div>
              </div>
            </div>
          </div>

          <div className="dora-grid">
            {/* 1. Deployment Frequency */}
            <div className="dora-card">
              <div className="dora-card-top">
                <span className="dora-metric-code">DF // 01</span>
                <span className={`dora-tier-pill ${stats.dora.deploymentFrequency.rating.toLowerCase()}`}>
                  {stats.dora.deploymentFrequency.rating.toUpperCase()}
                </span>
              </div>
              <h4 className="dora-card-name">DEPLOYMENT FREQUENCY</h4>
              <div className="dora-metric-val cyan">{stats.dora.deploymentFrequency.value}</div>
              <div className="dora-benchmark">
                <span className="bench-label">VIDAI TARGET</span>
                <span className="bench-target">{stats.dora.deploymentFrequency.target}</span>
              </div>
              <div className="dora-metric-meta">
                <span>Today: <strong>{stats.dora.deploymentFrequency.todayCount}</strong></span>
                <span className="meta-sep">•</span>
                <span>7-Day: <strong>{stats.dora.deploymentFrequency.weekCount} runs</strong></span>
              </div>
              <div className="dora-progress">
                <div
                  className="dora-progress-bar cyan"
                  style={{ width: `${Math.min(100, Math.max(15, (stats.dora.deploymentFrequency.dailyAverage / 5) * 100))}%` }}
                />
              </div>
            </div>

            {/* 2. Lead Time for Changes */}
            <div className="dora-card">
              <div className="dora-card-top">
                <span className="dora-metric-code">LTTC // 02</span>
                <span className={`dora-tier-pill ${stats.dora.leadTimeForChanges.rating.toLowerCase()}`}>
                  {stats.dora.leadTimeForChanges.rating.toUpperCase()}
                </span>
              </div>
              <h4 className="dora-card-name">LEAD TIME FOR CHANGES</h4>
              <div className="dora-metric-val purple">{stats.dora.leadTimeForChanges.value}</div>
              <div className="dora-benchmark">
                <span className="bench-label">VIDAI TARGET</span>
                <span className="bench-target">{stats.dora.leadTimeForChanges.target}</span>
              </div>
              <div className="dora-metric-meta">
                <span>Commit/Stage → Prod: <strong>~{stats.dora.leadTimeForChanges.hours}h</strong></span>
              </div>
              <div className="dora-progress">
                <div
                  className="dora-progress-bar purple"
                  style={{ width: `${Math.max(15, Math.min(100, (1 - (stats.dora.leadTimeForChanges.hours / 48)) * 100))}%` }}
                />
              </div>
            </div>

            {/* 3. Change Failure Rate */}
            <div className="dora-card">
              <div className="dora-card-top">
                <span className="dora-metric-code">CFR // 03</span>
                <span className={`dora-tier-pill ${stats.dora.changeFailureRate.rating.toLowerCase()}`}>
                  {stats.dora.changeFailureRate.rating.toUpperCase()}
                </span>
              </div>
              <h4 className="dora-card-name">CHANGE FAILURE RATE</h4>
              <div className={`dora-metric-val ${stats.dora.changeFailureRate.rate <= 5 ? 'green' : 'amber'}`}>
                {stats.dora.changeFailureRate.value}
              </div>
              <div className="dora-benchmark">
                <span className="bench-label">VIDAI TARGET</span>
                <span className="bench-target">{stats.dora.changeFailureRate.target}</span>
              </div>
              <div className="dora-metric-meta">
                <span>Prod CFR: <strong>{stats.dora.changeFailureRate.prodRate}%</strong></span>
                <span className="meta-sep">•</span>
                <span>Fleet: <strong>{stats.dora.changeFailureRate.failedCount}/{stats.dora.changeFailureRate.totalCount}</strong></span>
              </div>
              <div className="dora-progress">
                <div
                  className="dora-progress-bar green"
                  style={{ width: `${Math.max(10, Math.min(100, 100 - stats.dora.changeFailureRate.rate * 4))}%` }}
                />
              </div>
            </div>

            {/* 4. Mean Time to Recovery */}
            <div className="dora-card">
              <div className="dora-card-top">
                <span className="dora-metric-code">MTTR // 04</span>
                <span className={`dora-tier-pill ${stats.dora.meanTimeToRecovery.rating.toLowerCase()}`}>
                  {stats.dora.meanTimeToRecovery.rating.toUpperCase()}
                </span>
              </div>
              <h4 className="dora-card-name">MEAN TIME TO RECOVERY</h4>
              <div className="dora-metric-val emerald">{stats.dora.meanTimeToRecovery.value}</div>
              <div className="dora-benchmark">
                <span className="bench-label">VIDAI TARGET</span>
                <span className="bench-target">{stats.dora.meanTimeToRecovery.target}</span>
              </div>
              <div className="dora-metric-meta">
                <span>Median: <strong>{stats.dora.meanTimeToRecovery.medianMinutes}m</strong></span>
                <span className="meta-sep">•</span>
                <span>Recovered: <strong>{stats.dora.meanTimeToRecovery.totalRecovered} runs</strong></span>
              </div>
              <div className="dora-progress">
                <div
                  className="dora-progress-bar emerald"
                  style={{ width: `${Math.max(15, Math.min(100, (1 - (stats.dora.meanTimeToRecovery.minutes / 120)) * 100))}%` }}
                />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Middle Row: Environment Distribution & Status Breakdown */}
      <div className="panels-grid two-col">
        {/* Environment Breakdown */}
        <div className="panel-card">
          <div className="panel-terminal-bar">
            <div className="dots">
              <span className="dot red" />
              <span className="dot yellow" />
              <span className="dot green" />
            </div>
            <span className="panel-tag">cluster::distribution</span>
          </div>

          <h3 className="panel-title">DEPLOYMENTS BY TARGET ENVIRONMENT</h3>

          <div className="distribution-list">
            {Object.entries(stats.byEnvironment)
              .sort(([, a], [, b]) => b - a)
              .map(([env, count]) => {
                const percentage = stats.totalDeployments > 0
                  ? ((count / stats.totalDeployments) * 100).toFixed(1)
                  : '0';
                const clusterInfo = ENV_CLUSTER_MAP[env];
                return (
                  <div key={env} className="dist-row">
                    <div className="dist-head">
                      <div className="env-meta">
                        <span className="env-name-text">{env}</span>
                        {clusterInfo && (
                          <span className="cluster-subchip">
                            {clusterInfo.region} · {clusterInfo.clusterShort}
                          </span>
                        )}
                      </div>
                      <div className="dist-stats">
                        <span className="count-num">{count}</span>
                        <span className="pct-num">({percentage}%)</span>
                      </div>
                    </div>
                    <div className="progress-track">
                      <div
                        className="progress-fill cyan"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
          </div>
        </div>

        {/* Status Breakdown */}
        <div className="panel-card">
          <div className="panel-terminal-bar">
            <div className="dots">
              <span className="dot red" />
              <span className="dot yellow" />
              <span className="dot green" />
            </div>
            <span className="panel-tag">status::execution-matrix</span>
          </div>

          <h3 className="panel-title">PIPELINE EXECUTION STATUS</h3>

          <div className="distribution-list">
            {Object.entries(stats.byStatus)
              .sort(([, a], [, b]) => b - a)
              .map(([status, count]) => {
                const percentage = stats.totalDeployments > 0
                  ? ((count / stats.totalDeployments) * 100).toFixed(1)
                  : '0';

                let colorClass = 'cyan';
                if (status === 'Success') colorClass = 'green';
                else if (status === 'Failed') colorClass = 'red';
                else if (status === 'In Progress' || status === 'Pending') colorClass = 'yellow';
                else if (status === 'Cancelled' || status === 'Rolled Back') colorClass = 'neutral';

                return (
                  <div key={status} className="dist-row">
                    <div className="dist-head">
                      <span className={`status-pill ${colorClass}`}>
                        <span className="b-dot" />
                        {status.toUpperCase()}
                      </span>
                      <div className="dist-stats">
                        <span className="count-num">{count}</span>
                        <span className="pct-num">({percentage}%)</span>
                      </div>
                    </div>
                    <div className="progress-track">
                      <div
                        className={`progress-fill ${colorClass}`}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      {/* Bottom Row: Recent Failures, Slowest Deployments, Operator Leaderboard */}
      <div className="panels-grid three-col">
        {/* Recent Failures */}
        <div className="panel-card">
          <div className="panel-terminal-bar">
            <div className="dots">
              <span className="dot red" />
              <span className="dot yellow" />
              <span className="dot green" />
            </div>
            <span className="panel-tag incident">incident::audit-log</span>
          </div>

          <h3 className="panel-title">RECENT CRITICAL FAILURES</h3>

          {stats.recentFailures.length === 0 ? (
            <div className="empty-alert ok">
              <span className="alert-icon">✓</span>
              <div>ALL SYSTEMS NORMAL · ZERO ANOMALIES IN RECENT RUNS</div>
            </div>
          ) : (
            <div className="audit-feed">
              {stats.recentFailures.map((d, idx) => (
                <div key={idx} className="audit-card error">
                  <div className="audit-head">
                    <span className="fail-tag">FAIL</span>
                    <span className="audit-env">{d.environment}</span>
                    <span className="audit-time">{timeAgo(d.started_at)}</span>
                  </div>
                  <div className="audit-meta">
                    <span className="branch-chip">git:{d.branch || '—'}</span>
                    <span className="date-str">{new Date(d.started_at).toLocaleTimeString()}</span>
                  </div>
                  {d.notes && <div className="audit-note">{d.notes}</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Slowest Deployments (Latency Profiling) */}
        <div className="panel-card">
          <div className="panel-terminal-bar">
            <div className="dots">
              <span className="dot red" />
              <span className="dot yellow" />
              <span className="dot green" />
            </div>
            <span className="panel-tag">latency::profiling</span>
          </div>

          <h3 className="panel-title">LONGEST PIPELINE RUNS</h3>

          <div className="audit-feed">
            {stats.slowestDeployments.map((d, idx) => (
              <div key={idx} className="audit-card slow">
                <div className="audit-head">
                  <span className="duration-pill">
                    ⏱ {formatSeconds(d.duration_seconds)}
                  </span>
                  <span className="audit-env">{d.environment}</span>
                </div>
                <div className="audit-meta">
                  <span className="branch-chip">git:{d.branch || '—'}</span>
                  <span className="date-str">{new Date(d.started_at).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Operator Leaderboard */}
        <div className="panel-card">
          <div className="panel-terminal-bar">
            <div className="dots">
              <span className="dot red" />
              <span className="dot yellow" />
              <span className="dot green" />
            </div>
            <span className="panel-tag">operator::leaderboard</span>
          </div>

          <h3 className="panel-title">TOP DEVOPS OPERATORS</h3>

          <div className="operator-list">
            {Object.entries(stats.mostActiveUsers)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 10)
              .map(([user, count], index) => {
                const isTop = index === 0;
                return (
                  <div key={user} className="operator-row">
                    <div className="operator-left">
                      <span className={`rank-tag ${isTop ? 'gold' : index === 1 ? 'silver' : index === 2 ? 'bronze' : ''}`}>
                        #{String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="operator-name">@{user}</span>
                    </div>
                    <div className="operator-right">
                      <span className="op-count">{count}</span>
                      <span className="op-label">RUNS</span>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      {/* MTTR Recovery Audit Log */}
      {stats.dora && stats.dora.recentRecoveries && stats.dora.recentRecoveries.length > 0 && (
        <div className="panel-card recovery-panel">
          <div className="panel-terminal-bar">
            <div className="dots">
              <span className="dot red" />
              <span className="dot yellow" />
              <span className="dot green" />
            </div>
            <span className="panel-tag">dora::recovery-audit-log</span>
          </div>

          <div className="recovery-panel-header">
            <div>
              <h3 className="panel-title">INCIDENT RECOVERY &amp; MTTR AUDIT TRAIL</h3>
              <p className="panel-desc">
                Chronological ledger tracking incidents where a pipeline failure was resolved by a subsequent successful release on that environment.
              </p>
            </div>
            <div className="recovery-badge-count">
              <span className="rec-pulse-dot" />
              <span>{stats.dora.meanTimeToRecovery.totalRecovered} RECOVERIES LOGGED</span>
            </div>
          </div>

          <div className="recovery-table-wrapper">
            <table className="recovery-table">
              <thead>
                <tr>
                  <th>TARGET ENVIRONMENT</th>
                  <th>INCIDENT START</th>
                  <th>RECOVERED AT</th>
                  <th>TIME TO RESTORE (MTTR)</th>
                  <th>RECOVERY OPERATOR</th>
                  <th style={{ textAlign: 'right' }}>RUN AUDIT</th>
                </tr>
              </thead>
              <tbody>
                {stats.dora.recentRecoveries.map((inc, i) => (
                  <tr key={i}>
                    <td>
                      <span className="rec-env">{inc.environment}</span>
                    </td>
                    <td>
                      <span className="rec-date">{new Date(inc.failedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
                    </td>
                    <td>
                      <span className="rec-date">{new Date(inc.recoveredAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
                    </td>
                    <td>
                      <span className={`rec-mttr ${inc.durationMinutes <= 30 ? 'fast' : inc.durationMinutes <= 60 ? 'mid' : 'slow'}`}>
                        ⏱ {inc.durationMinutes < 60 ? `${inc.durationMinutes}m` : `${Math.floor(inc.durationMinutes / 60)}h ${inc.durationMinutes % 60}m`}
                      </span>
                    </td>
                    <td>
                      <span className="rec-author">@{inc.recoveredAuthor || inc.failedAuthor || 'GitHub Actions'}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="rec-links">
                        {inc.failedRunLink && (
                          <a href={inc.failedRunLink} target="_blank" rel="noopener noreferrer" className="rec-link fail">
                            Fail ↗
                          </a>
                        )}
                        {inc.recoveredRunLink && (
                          <a href={inc.recoveredRunLink} target="_blank" rel="noopener noreferrer" className="rec-link ok">
                            Fix ↗
                          </a>
                        )}
                        {!inc.failedRunLink && !inc.recoveredRunLink && <span className="rec-link-none">—</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <footer className="footer-note">
        VIDAI INFRASTRUCTURE COMMAND ENGINE // TELEMETRY PROBES AUDIT AP-SOUTH-1 &amp; US-WEST-2 CLUSTERS
      </footer>

      <style jsx>{`
        .admin-page {
          min-height: 100vh;
          background-color: #07090E;
          background-image:
            radial-gradient(ellipse 80% 50% at 50% -20%, rgba(0, 240, 255, 0.08), transparent),
            radial-gradient(circle at 100% 0%, rgba(255, 69, 0, 0.05), transparent),
            linear-gradient(rgba(33, 38, 45, 0.28) 1px, transparent 1px),
            linear-gradient(90deg, rgba(33, 38, 45, 0.28) 1px, transparent 1px);
          background-size: 100% 100%, 100% 100%, 32px 32px, 32px 32px;
          color: #E6EDF3;
          padding: 24px clamp(16px, 2.5vw, 32px) 80px;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        }

        /* Header */
        .top-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          flex-wrap: wrap;
          gap: 16px;
          margin-bottom: 24px;
          padding-bottom: 18px;
          border-bottom: 1px solid #21262D;
        }
        .terminal-cli-bar {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: rgba(0, 0, 0, 0.6);
          border: 1px solid rgba(0, 240, 255, 0.25);
          padding: 4px 10px;
          border-radius: 6px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          margin-bottom: 8px;
        }
        .cli-prefix { color: #00FF9D; font-weight: 700; }
        .cli-host { color: #00F0FF; }
        .cli-sep { color: #484F58; }
        .cli-path { color: #F59E0B; }
        .cli-git { color: #8B949E; }
        .cli-cmd { color: #484F58; }

        .title-section h1 {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 24px;
          font-weight: 700;
          letter-spacing: -0.01em;
          margin: 0 0 6px;
          color: #E6EDF3;
        }
        .sub-line {
          color: #8B949E;
          font-size: 12px;
          font-family: 'JetBrains Mono', monospace;
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .live-dot {
          color: #00FF9D;
          animation: livePulse 2s infinite;
          display: inline-block;
          font-size: 14px;
        }
        .live-dot.refreshing {
          animation: liveRefresh 0.3s ease;
          color: #00F0FF;
        }
        @keyframes livePulse {
          0%, 100% { opacity: 1; filter: drop-shadow(0 0 6px #00FF9D); }
          50% { opacity: 0.3; }
        }
        @keyframes liveRefresh {
          0% { transform: scale(1); }
          50% { transform: scale(1.6); }
          100% { transform: scale(1); }
        }
        .sys-badge {
          background: rgba(0, 255, 157, 0.12);
          color: #00FF9D;
          border: 1px solid rgba(0, 255, 157, 0.3);
          padding: 2px 7px;
          border-radius: 4px;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.05em;
        }

        .action-buttons {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
        }
        .btn {
          background: #161B22;
          border: 1px solid #21262D;
          color: #E6EDF3;
          padding: 8px 14px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          font-family: 'JetBrains Mono', monospace;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          transition: all 0.15s ease-in-out;
        }
        .btn:hover {
          border-color: #00F0FF;
          color: #00F0FF;
          box-shadow: 0 0 8px rgba(0, 240, 255, 0.2);
        }
        .btn.ghost { background: transparent; }
        .btn.danger:hover {
          border-color: #FF3366;
          color: #FF3366;
          box-shadow: 0 0 10px rgba(255, 51, 102, 0.3);
        }
        .copilot-pill {
          color: #c084fc;
          text-decoration: none;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          font-weight: 600;
          padding: 7px 12px;
          background: rgba(192, 132, 252, 0.1);
          border: 1px solid rgba(192, 132, 252, 0.25);
          border-radius: 6px;
          transition: all 0.2s;
        }
        .copilot-pill:hover {
          background: rgba(192, 132, 252, 0.2);
          box-shadow: 0 0 12px rgba(192, 132, 252, 0.35);
          color: #e9d5ff;
        }

        /* HUD Ribbon */
        .hud-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
          gap: 12px;
          margin-bottom: 24px;
        }
        .hud-card {
          position: relative;
          background: rgba(13, 17, 23, 0.85);
          border: 1px solid #21262D;
          border-radius: 10px;
          padding: 14px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          gap: 4px;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
          transition: all 0.2s;
        }
        .hud-card:hover {
          border-color: rgba(0, 240, 255, 0.4);
          transform: translateY(-1px);
        }
        .hud-stripe {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
        }
        .hud-label {
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          font-weight: 700;
          color: #8B949E;
          letter-spacing: 0.05em;
        }
        .hud-value {
          font-family: 'JetBrains Mono', monospace;
          font-size: 20px;
          font-weight: 700;
          color: #E6EDF3;
          display: flex;
          align-items: center;
          gap: 6px;
          margin: 2px 0;
        }
        .hud-value.accent { color: #00F0FF; }
        .hud-value.ok { color: #00FF9D; }
        .hud-value.bad { color: #FF3366; }
        .hud-value.warn { color: #F59E0B; }
        .hud-value.sky { color: #38BDF8; }
        .hud-value.prod { color: #FF4500; }
        .hud-sub {
          font-size: 11px;
          color: #484F58;
          font-family: 'JetBrains Mono', monospace;
        }
        .dot-pulse {
          width: 7px;
          height: 7px;
          border-radius: 50%;
        }
        .dot-pulse.ok {
          background: #00FF9D;
          box-shadow: 0 0 8px #00FF9D;
        }

        /* Panels Grid */
        .panels-grid {
          display: grid;
          gap: 16px;
          margin-bottom: 24px;
        }
        .panels-grid.two-col {
          grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
        }
        .panels-grid.three-col {
          grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        }

        .panel-card {
          background: #0D1117;
          border: 1px solid #21262D;
          border-radius: 10px;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
          transition: border-color 0.2s;
        }
        .panel-card:hover {
          border-color: rgba(0, 240, 255, 0.3);
        }
        .panel-terminal-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-bottom: 8px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          font-family: 'JetBrains Mono', monospace;
        }
        .dots { display: flex; gap: 4px; }
        .dot { width: 7px; height: 7px; border-radius: 50%; }
        .dot.red { background: #FF5F56; }
        .dot.yellow { background: #FFBD2E; }
        .dot.green { background: #27C93F; }
        .panel-tag {
          font-size: 10px;
          color: #484F58;
          font-family: 'JetBrains Mono', monospace;
          letter-spacing: 0.04em;
        }
        .panel-tag.incident { color: #FF3366; }

        .panel-title {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 13px;
          font-weight: 700;
          color: #8B949E;
          letter-spacing: 0.05em;
          margin: 0;
        }

        /* Distribution Lists */
        .distribution-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .dist-row {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .dist-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 12px;
          font-family: 'JetBrains Mono', monospace;
        }
        .env-meta {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .env-name-text {
          font-weight: 700;
          color: #E6EDF3;
        }
        .cluster-subchip {
          font-size: 10px;
          color: #484F58;
          background: rgba(255, 255, 255, 0.04);
          padding: 1px 5px;
          border-radius: 3px;
        }
        .dist-stats {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .count-num { font-weight: 700; color: #00F0FF; }
        .pct-num { color: #8B949E; font-size: 11px; }

        .progress-track {
          height: 6px;
          background: #161B22;
          border-radius: 3px;
          overflow: hidden;
        }
        .progress-fill {
          height: 100%;
          border-radius: 3px;
          transition: width 0.4s ease;
        }
        .progress-fill.cyan { background: #00F0FF; box-shadow: 0 0 8px rgba(0, 240, 255, 0.5); }
        .progress-fill.green { background: #00FF9D; box-shadow: 0 0 8px rgba(0, 255, 157, 0.5); }
        .progress-fill.red { background: #FF3366; box-shadow: 0 0 8px rgba(255, 51, 102, 0.5); }
        .progress-fill.yellow { background: #F59E0B; box-shadow: 0 0 8px rgba(245, 158, 11, 0.5); }
        .progress-fill.neutral { background: #8B949E; }

        /* Status Pills */
        .status-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 2px 7px;
          border-radius: 3px;
          font-size: 10.5px;
          font-weight: 700;
          font-family: 'JetBrains Mono', monospace;
        }
        .b-dot { width: 5px; height: 5px; border-radius: 50%; }
        .status-pill.green { background: rgba(0, 255, 157, 0.12); color: #00FF9D; border: 1px solid rgba(0, 255, 157, 0.3); }
        .status-pill.green .b-dot { background: #00FF9D; }
        .status-pill.red { background: rgba(255, 51, 102, 0.12); color: #FF3366; border: 1px solid rgba(255, 51, 102, 0.3); }
        .status-pill.red .b-dot { background: #FF3366; }
        .status-pill.yellow { background: rgba(245, 158, 11, 0.12); color: #F59E0B; border: 1px solid rgba(245, 158, 11, 0.3); }
        .status-pill.yellow .b-dot { background: #F59E0B; }
        .status-pill.neutral { background: rgba(139, 148, 158, 0.12); color: #8B949E; border: 1px solid rgba(139, 148, 158, 0.3); }
        .status-pill.neutral .b-dot { background: #8B949E; }

        /* Audit Feed / Incident Log */
        .audit-feed {
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-height: 420px;
          overflow-y: auto;
        }
        .audit-card {
          background: #161B22;
          border: 1px solid #21262D;
          border-radius: 6px;
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-family: 'JetBrains Mono', monospace;
        }
        .audit-card.error {
          border-left: 3px solid #FF3366;
        }
        .audit-card.slow {
          border-left: 3px solid #F59E0B;
        }
        .audit-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .fail-tag {
          font-size: 9px;
          background: rgba(255, 51, 102, 0.2);
          color: #FF3366;
          border: 1px solid rgba(255, 51, 102, 0.4);
          padding: 1px 5px;
          border-radius: 3px;
          font-weight: 700;
        }
        .duration-pill {
          font-size: 11px;
          color: #F59E0B;
          background: rgba(245, 158, 11, 0.12);
          border: 1px solid rgba(245, 158, 11, 0.3);
          padding: 1px 6px;
          border-radius: 3px;
          font-weight: 700;
        }
        .audit-env {
          font-weight: 700;
          font-size: 12px;
          color: #E6EDF3;
        }
        .audit-time {
          font-size: 10.5px;
          color: #8B949E;
        }
        .audit-meta {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 11px;
          color: #484F58;
        }
        .branch-chip {
          color: #00F0FF;
          background: rgba(0, 240, 255, 0.08);
          padding: 1px 5px;
          border-radius: 3px;
          font-size: 10px;
        }
        .date-str { font-size: 10.5px; }
        .audit-note {
          font-size: 10.5px;
          color: #8B949E;
          background: rgba(0, 0, 0, 0.3);
          padding: 4px 6px;
          border-radius: 4px;
          margin-top: 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .empty-alert {
          display: flex;
          align-items: center;
          gap: 8px;
          background: rgba(0, 255, 157, 0.08);
          border: 1px solid rgba(0, 255, 157, 0.25);
          color: #00FF9D;
          padding: 16px;
          border-radius: 6px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          font-weight: 600;
        }
        .alert-icon { font-size: 16px; font-weight: 700; }

        /* Operator Leaderboard */
        .operator-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .operator-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 10px;
          background: #161B22;
          border: 1px solid rgba(255, 255, 255, 0.03);
          border-radius: 6px;
          font-family: 'JetBrains Mono', monospace;
          transition: border-color 0.15s;
        }
        .operator-row:hover {
          border-color: rgba(0, 240, 255, 0.3);
        }
        .operator-left {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .rank-tag {
          font-size: 10px;
          font-weight: 700;
          color: #8B949E;
          background: rgba(255, 255, 255, 0.05);
          padding: 2px 5px;
          border-radius: 3px;
        }
        .rank-tag.gold {
          color: #FFD700;
          background: rgba(255, 215, 0, 0.15);
          border: 1px solid rgba(255, 215, 0, 0.3);
        }
        .rank-tag.silver {
          color: #E6EDF3;
          background: rgba(230, 237, 243, 0.15);
          border: 1px solid rgba(230, 237, 243, 0.3);
        }
        .rank-tag.bronze {
          color: #CD7F32;
          background: rgba(205, 127, 50, 0.15);
          border: 1px solid rgba(205, 127, 50, 0.3);
        }
        .operator-name {
          font-size: 12px;
          color: #E6EDF3;
          font-weight: 600;
        }
        .operator-right {
          display: flex;
          align-items: center;
          gap: 5px;
        }
        .op-count {
          font-size: 13px;
          font-weight: 700;
          color: #00F0FF;
        }
        .op-label {
          font-size: 9.5px;
          color: #484F58;
          font-weight: 700;
        }

        /* DORA Metrics Section */
        .dora-section {
          background: rgba(13, 17, 23, 0.9);
          border: 1px solid rgba(0, 240, 255, 0.25);
          border-radius: 12px;
          padding: 20px 24px;
          margin-bottom: 28px;
          box-shadow: 0 0 25px rgba(0, 240, 255, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.05);
        }
        .dora-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 16px;
          margin-bottom: 20px;
          padding-bottom: 16px;
          border-bottom: 1px solid #21262D;
        }
        .dora-header-left {
          max-width: 720px;
        }
        .dora-title-group {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 6px;
        }
        .dora-glow-badge {
          background: rgba(0, 240, 255, 0.12);
          color: #00F0FF;
          border: 1px solid rgba(0, 240, 255, 0.35);
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          font-weight: 700;
          padding: 3px 8px;
          border-radius: 4px;
          letter-spacing: 0.06em;
        }
        .dora-title {
          font-size: 15px;
          font-weight: 800;
          letter-spacing: 0.05em;
          color: #F0F6FC;
          font-family: 'JetBrains Mono', monospace;
          margin: 0;
        }
        .dora-subtitle {
          font-size: 12px;
          color: #8B949E;
          margin: 0;
          line-height: 1.5;
        }
        .dora-overall-badge {
          display: flex;
          align-items: center;
          gap: 10px;
          background: #161B22;
          border: 1px solid #30363D;
          border-radius: 8px;
          padding: 8px 14px;
          font-family: 'JetBrains Mono', monospace;
        }
        .dora-overall-badge.elite {
          border-color: rgba(0, 255, 157, 0.5);
          background: rgba(0, 255, 157, 0.08);
        }
        .dora-overall-badge.high {
          border-color: rgba(0, 240, 255, 0.5);
          background: rgba(0, 240, 255, 0.08);
        }
        .tier-light {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #00FF9D;
          box-shadow: 0 0 10px #00FF9D;
        }
        .dora-overall-badge.high .tier-light {
          background: #00F0FF;
          box-shadow: 0 0 10px #00F0FF;
        }
        .tier-content {
          display: flex;
          flex-direction: column;
        }
        .tier-label {
          font-size: 9px;
          font-weight: 700;
          color: #8B949E;
          letter-spacing: 0.05em;
        }
        .tier-val {
          font-size: 13px;
          font-weight: 800;
          color: #00FF9D;
          letter-spacing: 0.04em;
        }
        .dora-overall-badge.high .tier-val {
          color: #00F0FF;
        }
        .dora-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 14px;
        }
        .dora-card {
          background: rgba(22, 27, 34, 0.7);
          border: 1px solid #21262D;
          border-radius: 8px;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          transition: all 0.2s;
        }
        .dora-card:hover {
          border-color: rgba(0, 240, 255, 0.35);
          transform: translateY(-2px);
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
        }
        .dora-card-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .dora-metric-code {
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          font-weight: 700;
          color: #484F58;
          letter-spacing: 0.05em;
        }
        .dora-tier-pill {
          font-family: 'JetBrains Mono', monospace;
          font-size: 9.5px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 4px;
          letter-spacing: 0.04em;
        }
        .dora-tier-pill.elite {
          background: rgba(0, 255, 157, 0.15);
          color: #00FF9D;
          border: 1px solid rgba(0, 255, 157, 0.3);
        }
        .dora-tier-pill.high {
          background: rgba(0, 240, 255, 0.15);
          color: #00F0FF;
          border: 1px solid rgba(0, 240, 255, 0.3);
        }
        .dora-tier-pill.medium {
          background: rgba(245, 158, 11, 0.15);
          color: #F59E0B;
          border: 1px solid rgba(245, 158, 11, 0.3);
        }
        .dora-tier-pill.low {
          background: rgba(255, 51, 102, 0.15);
          color: #FF3366;
          border: 1px solid rgba(255, 51, 102, 0.3);
        }
        .dora-card-name {
          font-size: 11px;
          font-weight: 700;
          color: #8B949E;
          letter-spacing: 0.05em;
          margin: 0;
          font-family: 'JetBrains Mono', monospace;
        }
        .dora-metric-val {
          font-family: 'JetBrains Mono', monospace;
          font-size: 26px;
          font-weight: 800;
          margin: 2px 0;
          line-height: 1.1;
        }
        .dora-metric-val.cyan { color: #00F0FF; }
        .dora-metric-val.purple { color: #C084FC; }
        .dora-metric-val.green { color: #00FF9D; }
        .dora-metric-val.amber { color: #F59E0B; }
        .dora-metric-val.emerald { color: #10B981; }
        .dora-benchmark {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          background: rgba(0, 0, 0, 0.25);
          padding: 4px 8px;
          border-radius: 4px;
          border: 1px solid rgba(255, 255, 255, 0.04);
        }
        .bench-label {
          color: #6E7681;
          font-weight: 600;
        }
        .bench-target {
          color: #E6EDF3;
          font-weight: 700;
        }
        .dora-metric-meta {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 10.5px;
          color: #8B949E;
          font-family: 'JetBrains Mono', monospace;
        }
        .dora-metric-meta strong {
          color: #F0F6FC;
        }
        .meta-sep {
          color: #30363D;
        }
        .dora-progress {
          height: 4px;
          background: rgba(255, 255, 255, 0.06);
          border-radius: 2px;
          overflow: hidden;
          margin-top: 4px;
        }
        .dora-progress-bar {
          height: 100%;
          border-radius: 2px;
          transition: width 0.3s ease;
        }
        .dora-progress-bar.cyan { background: #00F0FF; }
        .dora-progress-bar.purple { background: #C084FC; }
        .dora-progress-bar.green { background: #00FF9D; }
        .dora-progress-bar.emerald { background: #10B981; }

        /* MTTR Recovery Panel & Table */
        .recovery-panel {
          margin-top: 24px;
        }
        .recovery-panel-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          flex-wrap: wrap;
          gap: 12px;
          margin-bottom: 16px;
        }
        .panel-desc {
          font-size: 11px;
          color: #8B949E;
          margin: 4px 0 0 0;
          font-family: 'JetBrains Mono', monospace;
        }
        .recovery-badge-count {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: rgba(0, 255, 157, 0.1);
          color: #00FF9D;
          border: 1px solid rgba(0, 255, 157, 0.25);
          border-radius: 6px;
          padding: 4px 10px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 10.5px;
          font-weight: 700;
        }
        .rec-pulse-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #00FF9D;
          box-shadow: 0 0 6px #00FF9D;
        }
        .recovery-table-wrapper {
          overflow-x: auto;
          border: 1px solid #21262D;
          border-radius: 6px;
        }
        .recovery-table {
          width: 100%;
          border-collapse: collapse;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
        }
        .recovery-table th {
          background: #161B22;
          color: #8B949E;
          text-align: left;
          padding: 10px 14px;
          font-weight: 700;
          letter-spacing: 0.04em;
          border-bottom: 1px solid #21262D;
        }
        .recovery-table td {
          padding: 10px 14px;
          border-bottom: 1px solid rgba(33, 38, 45, 0.6);
          color: #C9D1D9;
        }
        .recovery-table tr:hover td {
          background: rgba(22, 27, 34, 0.6);
        }
        .rec-env {
          font-weight: 700;
          color: #00F0FF;
        }
        .rec-date {
          color: #8B949E;
        }
        .rec-mttr {
          display: inline-block;
          font-weight: 700;
          padding: 2px 7px;
          border-radius: 4px;
        }
        .rec-mttr.fast {
          color: #00FF9D;
          background: rgba(0, 255, 157, 0.12);
          border: 1px solid rgba(0, 255, 157, 0.25);
        }
        .rec-mttr.mid {
          color: #38BDF8;
          background: rgba(56, 189, 248, 0.12);
          border: 1px solid rgba(56, 189, 248, 0.25);
        }
        .rec-mttr.slow {
          color: #F59E0B;
          background: rgba(245, 158, 11, 0.12);
          border: 1px solid rgba(245, 158, 11, 0.25);
        }
        .rec-author {
          color: #E6EDF3;
          font-weight: 600;
        }
        .rec-links {
          display: flex;
          justify-content: flex-end;
          gap: 6px;
        }
        .rec-link {
          font-size: 10px;
          padding: 2px 7px;
          border-radius: 4px;
          text-decoration: none;
          font-weight: 600;
          transition: all 0.15s;
        }
        .rec-link.fail {
          background: rgba(255, 51, 102, 0.12);
          color: #FF3366;
          border: 1px solid rgba(255, 51, 102, 0.3);
        }
        .rec-link.fail:hover {
          background: rgba(255, 51, 102, 0.25);
          box-shadow: 0 0 8px rgba(255, 51, 102, 0.3);
        }
        .rec-link.ok {
          background: rgba(0, 255, 157, 0.12);
          color: #00FF9D;
          border: 1px solid rgba(0, 255, 157, 0.3);
        }
        .rec-link.ok:hover {
          background: rgba(0, 255, 157, 0.25);
          box-shadow: 0 0 8px rgba(0, 255, 157, 0.3);
        }
        .rec-link-none {
          color: #484F58;
        }

        .footer-note {
          margin-top: 36px;
          color: #484F58;
          font-size: 11px;
          line-height: 1.6;
          text-align: center;
          font-family: 'JetBrains Mono', monospace;
          letter-spacing: 0.04em;
        }
      `}</style>
    </div>
  );
}
