'use client';
import { useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  Clock,
  RotateCcw,
  TrendingUp,
  Calendar,
} from 'lucide-react';
import { useShell } from './ctx';

interface SummaryData {
  total: number;
  success: number;
  failed: number;
  queued?: number;
  awaiting_approval?: number;
  rejected?: number;
  rollbacks: number;
  today: number;
  days: {
    date: string;
    success: number;
    failed: number;
    other: number;
    total: number;
  }[];
}

export default function ReleaseStats() {
  const { refreshKey } = useShell();
  const [data, setData] = useState<SummaryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeDay, setActiveDay] = useState<SummaryData['days'][number] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/summary', { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (alive) {
          setData(d as SummaryData);
          setError(null);
        }
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load summary');
      });

    return () => {
      alive = false;
    };
  }, [refreshKey]);

  if (!data) {
    return (
      <div className="stats-grid">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="stat-card is-loading">
            <div className="skeleton-line w-24" />
            <div className="skeleton-line w-16 h-8" />
          </div>
        ))}
      </div>
    );
  }

  // Calculate success rate excluding currently open/queued/awaiting runs
  const resolvedTotal = data.success + data.failed;
  const successRate = resolvedTotal > 0 ? (data.success / resolvedTotal) * 100 : 100;
  const maxDayTotal = Math.max(1, ...data.days.map((d) => d.total));

  // Circular progress math
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const strokeOffset = circumference - (Math.min(100, Math.max(0, successRate)) / 100) * circumference;

  return (
    <div className="stats-section">
      <div className="stats-cards-grid">
        {/* Total Deployments */}
        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-label">Total Releases</span>
            <Activity size={16} className="stat-icon text-accent" />
          </div>
          <div className="stat-value-row">
            <span className="stat-value tnum">{data.total.toLocaleString()}</span>
          </div>
          <div className="stat-subtext">All-time recorded pipelines</div>
        </div>

        {/* Success Rate */}
        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-label">Success Rate</span>
            <CheckCircle2 size={16} className="stat-icon text-success" />
          </div>
          <div className="stat-value-row">
            <div className="stat-ring-wrap">
              <svg width="44" height="44" viewBox="0 0 44 44" className="stat-svg-ring">
                <circle
                  cx="22"
                  cy="22"
                  r={radius}
                  className="ring-bg"
                  fill="none"
                  strokeWidth="4"
                />
                <circle
                  cx="22"
                  cy="22"
                  r={radius}
                  className="ring-progress"
                  fill="none"
                  strokeWidth="4"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeOffset}
                  strokeLinecap="round"
                  transform="rotate(-90 22 22)"
                />
              </svg>
            </div>
            <span className="stat-value tnum">{successRate.toFixed(1)}%</span>
          </div>
          <div className="stat-subtext">
            {data.success.toLocaleString()} succeeded · {data.failed} failed
          </div>
        </div>

        {/* Today's Volume */}
        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-label">Today&apos;s Deployments</span>
            <Calendar size={16} className="stat-icon text-info" />
          </div>
          <div className="stat-value-row">
            <span className="stat-value tnum">{data.today}</span>
          </div>
          <div className="stat-subtext">
            {data.days.slice(-7).reduce((acc, d) => acc + d.total, 0)} deploys in last 7 days
          </div>
        </div>

        {/* Active & Rollbacks */}
        <div className="stat-card">
          <div className="stat-header">
            <span className="stat-label">Queue &amp; Rollbacks</span>
            <Clock size={16} className="stat-icon text-warn" />
          </div>
          <div className="stat-value-row">
            <span className="stat-value tnum">
              {(data.queued ?? 0) + (data.awaiting_approval ?? 0)}
            </span>
            <span className="stat-badge-small">
              {data.rollbacks} rollbacks
            </span>
          </div>
          <div className="stat-subtext">
            {data.queued ?? 0} queued · {data.awaiting_approval ?? 0} awaiting approval
          </div>
        </div>
      </div>

      {/* 14-Day Delivery Pulse Timeline */}
      <div className="pulse-chart-card">
        <div className="pulse-header">
          <div>
            <h3 className="pulse-title">14-Day Delivery Pulse</h3>
            <span className="pulse-subtitle">Daily deployment volume and completion outcomes</span>
          </div>

          <div className="pulse-legend">
            <span className="legend-item">
              <span className="legend-box is-success" />
              <span>Success</span>
            </span>
            <span className="legend-item">
              <span className="legend-box is-failed" />
              <span>Failed</span>
            </span>
            <span className="legend-item">
              <span className="legend-box is-other" />
              <span>Other / Open</span>
            </span>
          </div>
        </div>

        <div className="pulse-chart-body">
          <div className="pulse-bars-grid">
            {data.days.map((day) => {
              const dayDate = new Date(day.date);
              const label = dayDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
              const successH = (day.success / maxDayTotal) * 100;
              const failH = (day.failed / maxDayTotal) * 100;
              const otherH = (day.other / maxDayTotal) * 100;

              return (
                <div
                  key={day.date}
                  className="pulse-col"
                  onMouseEnter={() => setActiveDay(day)}
                  onMouseLeave={() => setActiveDay(null)}
                >
                  <div className="pulse-bar-track">
                    {day.total > 0 && (
                      <div className="pulse-bar-stack">
                        {day.other > 0 && (
                          <div
                            className="pulse-bar-seg is-other"
                            style={{ height: `${otherH}%` }}
                            title={`${day.other} other`}
                          />
                        )}
                        {day.failed > 0 && (
                          <div
                            className="pulse-bar-seg is-failed"
                            style={{ height: `${failH}%` }}
                            title={`${day.failed} failed`}
                          />
                        )}
                        {day.success > 0 && (
                          <div
                            className="pulse-bar-seg is-success"
                            style={{ height: `${successH}%` }}
                            title={`${day.success} success`}
                          />
                        )}
                      </div>
                    )}
                  </div>
                  <span className="pulse-col-label">{label}</span>
                  <span className="pulse-col-count tnum">{day.total || '—'}</span>
                </div>
              );
            })}
          </div>

          {/* Interactive hover inspector */}
          {activeDay && (
            <div className="pulse-inspector">
              <span className="inspector-date">
                {new Date(activeDay.date).toLocaleDateString('en-GB', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </span>
              <span className="inspector-metric text-success">
                ✓ {activeDay.success} Success
              </span>
              {activeDay.failed > 0 && (
                <span className="inspector-metric text-danger">
                  ✕ {activeDay.failed} Failed
                </span>
              )}
              {activeDay.other > 0 && (
                <span className="inspector-metric text-muted">
                  • {activeDay.other} Other
                </span>
              )}
              <span className="inspector-total">
                Total: {activeDay.total}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
