'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface Stats {
  totalDeployments: number;
  successRate: number;
  failureRate: number;
  avgDuration: number;
  deploymentsToday: number;
  deploymentsThisWeek: number;
  byEnvironment: Record<string, number>;
  byStatus: Record<string, number>;
  recentFailures: any[];
  slowestDeployments: any[];
  mostActiveUsers: Record<string, number>;
}

export default function AdminDashboard() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/auth/session');
      const data = await res.json();
      
      if (!data.authenticated) {
        router.push('/');
        return;
      }
      
      setIsAdmin(true);
      loadStats();
    } catch (error) {
      router.push('/');
    }
  };

  const loadStats = async () => {
    try {
      const res = await fetch('/api/admin/stats');
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (error) {
      console.error('Failed to load stats:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        background: 'var(--bg)',
        color: 'var(--text)'
      }}>
        Loading admin dashboard...
      </div>
    );
  }

  if (!isAdmin || !stats) {
    return null;
  }

  return (
    <div style={{ 
      minHeight: '100vh',
      background: 'radial-gradient(1200px 600px at 10% -10%, rgba(91,141,239,0.08), transparent), radial-gradient(900px 500px at 100% 0%, rgba(245,166,35,0.05), transparent), var(--bg)',
      color: 'var(--text)',
      fontFamily: 'Inter, sans-serif',
      padding: '32px'
    }}>
      {/* Header */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '32px'
      }}>
        <div>
          <h1 style={{ 
            fontSize: '28px', 
            fontWeight: 700, 
            margin: 0,
            fontFamily: 'Space Grotesk, sans-serif'
          }}>
            Admin Dashboard
          </h1>
          <p style={{ color: 'var(--muted)', margin: '4px 0 0' }}>
            Enhanced analytics and insights
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={() => router.push('/')}
            style={{
              padding: '10px 16px',
              background: 'var(--panel-2)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              color: 'var(--text)',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 600
            }}
          >
            ← Back to Tracker
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '16px',
        marginBottom: '32px'
      }}>
        <StatCard title="Total Deployments" value={stats.totalDeployments} color="#5B8DEF" />
        <StatCard title="Success Rate" value={`${stats.successRate.toFixed(1)}%`} color="#3DD68C" />
        <StatCard title="Failure Rate" value={`${stats.failureRate.toFixed(1)}%`} color="#FF6B6B" />
        <StatCard title="Avg Duration" value={`${Math.round(stats.avgDuration / 60)}m`} color="#F5B942" />
        <StatCard title="Today" value={stats.deploymentsToday} color="#7AA3F5" />
        <StatCard title="This Week" value={stats.deploymentsThisWeek} color="#F5A623" />
      </div>

      {/* Charts Row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: '16px',
        marginBottom: '32px'
      }}>
        {/* By Environment */}
        <div style={{
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '20px'
        }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>
            Deployments by Environment
          </h3>
          {Object.entries(stats.byEnvironment).map(([env, count]) => (
            <div key={env} style={{ marginBottom: '12px' }}>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between',
                marginBottom: '4px',
                fontSize: '13px'
              }}>
                <span>{env}</span>
                <span style={{ fontWeight: 600 }}>{count}</span>
              </div>
              <div style={{
                height: '6px',
                background: 'var(--panel-2)',
                borderRadius: '3px',
                overflow: 'hidden'
              }}>
                <div style={{
                  height: '100%',
                  width: `${(count / stats.totalDeployments) * 100}%`,
                  background: 'var(--accent)',
                  transition: 'width 0.3s'
                }} />
              </div>
            </div>
          ))}
        </div>

        {/* By Status */}
        <div style={{
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '20px'
        }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>
            Deployments by Status
          </h3>
          {Object.entries(stats.byStatus).map(([status, count]) => {
            const colors: Record<string, string> = {
              'Success': '#3DD68C',
              'Failed': '#FF6B6B',
              'Cancelled': '#F5B942',
              'In Progress': '#5B8DEF'
            };
            return (
              <div key={status} style={{ marginBottom: '12px' }}>
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between',
                  marginBottom: '4px',
                  fontSize: '13px'
                }}>
                  <span>{status}</span>
                  <span style={{ fontWeight: 600 }}>{count}</span>
                </div>
                <div style={{
                  height: '6px',
                  background: 'var(--panel-2)',
                  borderRadius: '3px',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    height: '100%',
                    width: `${(count / stats.totalDeployments) * 100}%`,
                    background: colors[status] || 'var(--muted)',
                    transition: 'width 0.3s'
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Tables Row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
        gap: '16px'
      }}>
        {/* Recent Failures */}
        <div style={{
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '20px'
        }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>
            Recent Failures
          </h3>
          {stats.recentFailures.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: '13px' }}>No recent failures</p>
          ) : (
            stats.recentFailures.map((d, idx) => (
              <div key={idx} style={{
                padding: '10px',
                background: 'var(--panel-2)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                marginBottom: '8px',
                fontSize: '13px'
              }}>
                <div style={{ fontWeight: 600, marginBottom: '4px' }}>{d.environment}</div>
                <div style={{ color: 'var(--muted)', fontSize: '12px' }}>
                  {new Date(d.started_at).toLocaleString()} · {d.branch}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Slowest Deployments */}
        <div style={{
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '20px'
        }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>
            Slowest Deployments
          </h3>
          {stats.slowestDeployments.map((d, idx) => (
            <div key={idx} style={{
              padding: '10px',
              background: 'var(--panel-2)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              marginBottom: '8px',
              fontSize: '13px'
            }}>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between',
                marginBottom: '4px'
              }}>
                <span style={{ fontWeight: 600 }}>{d.environment}</span>
                <span style={{ color: 'var(--warn)' }}>
                  {Math.round(d.duration_seconds / 60)}m {d.duration_seconds % 60}s
                </span>
              </div>
              <div style={{ color: 'var(--muted)', fontSize: '12px' }}>
                {new Date(d.started_at).toLocaleString()}
              </div>
            </div>
          ))}
        </div>

        {/* Most Active Users */}
        <div style={{
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '20px'
        }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>
            Most Active Users
          </h3>
          {Object.entries(stats.mostActiveUsers)
            .sort(([, a], [, b]) => (b as number) - (a as number))
            .slice(0, 10)
            .map(([user, count]) => (
              <div key={user} style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '8px 0',
                borderBottom: '1px solid var(--border)',
                fontSize: '13px'
              }}>
                <span>{user}</span>
                <span style={{ fontWeight: 600, color: 'var(--accent)' }}>{count}</span>
              </div>
            ))}
        </div>
      </div>

      <style jsx global>{`
        :root {
          --bg: #0B0E14;
          --text: #E6E8EB;
          --muted: #9BA1AA;
          --faint: #6B7280;
          --panel: #161A23;
          --panel-2: #1C2128;
          --border: #2D333E;
          --accent: #5B8DEF;
          --ok: #3DD68C;
          --warn: #F5B942;
          --bad: #FF6B6B;
          --prod: #F5A623;
        }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          background: var(--bg);
          color: var(--text);
          font-family: 'Inter', system-ui, sans-serif;
        }
      `}</style>
    </div>
  );
}

function StatCard({ title, value, color }: { title: string; value: string | number; color: string }) {
  return (
    <div style={{
      background: 'var(--panel)',
      border: '1px solid var(--border)',
      borderRadius: '12px',
      padding: '20px',
      position: 'relative',
      overflow: 'hidden'
    }}>
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '3px',
        background: color
      }} />
      <div style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '8px' }}>
        {title}
      </div>
      <div style={{ fontSize: '28px', fontWeight: 700, color }}>
        {value}
      </div>
    </div>
  );
}
