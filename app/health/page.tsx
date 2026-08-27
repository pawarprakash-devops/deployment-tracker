'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface EnvironmentHealth {
  id: string;
  environment: string;
  is_production: boolean;
  display_order: number;
  status: string | null;
  deployment_type: string | null;
  branch: string | null;
  version: string | null;
  deployed_by: string | null;
  last_deployed_at: string | null;
  completed_at: string | null;
  duration_seconds: number | null;
}

export default function HealthDashboard() {
  const [healthData, setHealthData] = useState<EnvironmentHealth[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 10000); // Refresh every 10 seconds
    return () => clearInterval(interval);
  }, []);

  const fetchHealth = async () => {
    try {
      const response = await fetch('/api/health');
      const data = await response.json();
      if (Array.isArray(data)) {
        setHealthData(data);
      }
    } catch (error) {
      console.error('Error fetching health data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return '-';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const getHealthStatus = (lastDeployed: string | null) => {
    if (!lastDeployed) return { color: 'bg-gray-500', text: 'Never Deployed' };
    
    const daysSince = Math.floor(
      (Date.now() - new Date(lastDeployed).getTime()) / (1000 * 60 * 60 * 24)
    );
    
    if (daysSince === 0) return { color: 'bg-green-500', text: 'Fresh' };
    if (daysSince <= 7) return { color: 'bg-blue-500', text: 'Current' };
    if (daysSince <= 30) return { color: 'bg-yellow-500', text: 'Aging' };
    return { color: 'bg-red-500', text: 'Stale' };
  };

  const getTypeColor = (type: string | null) => {
    switch (type) {
      case 'rollback': return 'bg-yellow-100 text-yellow-800';
      case 'hotfix': return 'bg-orange-100 text-orange-800';
      case 'standard': return 'bg-blue-100 text-blue-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">Loading health data...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Environment Health Dashboard</h1>
            <p className="text-gray-600 mt-1">Current deployment status across all environments</p>
          </div>
          <Link
            href="/"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            ← Back to Deployments
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {healthData.map((env) => {
            const healthStatus = getHealthStatus(env.last_deployed_at);
            const daysSince = env.last_deployed_at
              ? Math.floor(
                  (Date.now() - new Date(env.last_deployed_at).getTime()) / (1000 * 60 * 60 * 24)
                )
              : null;

            return (
              <div
                key={env.id}
                className={`bg-white rounded-lg shadow-md p-6 border-l-4 ${
                  env.is_production ? 'border-red-500' : 'border-blue-500'
                }`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900">{env.environment}</h2>
                    {env.is_production && (
                      <span className="inline-block mt-1 px-2 py-1 text-xs bg-red-100 text-red-800 rounded-full">
                        PRODUCTION
                      </span>
                    )}
                  </div>
                  <div className={`w-3 h-3 rounded-full ${healthStatus.color} animate-pulse`} />
                </div>

                <div className="space-y-3">
                  <div>
                    <div className="text-xs text-gray-500 uppercase mb-1">Status</div>
                    <div className={`inline-block px-2 py-1 rounded text-sm ${healthStatus.color} text-white`}>
                      {healthStatus.text}
                      {daysSince !== null && daysSince > 0 && ` (${daysSince}d ago)`}
                    </div>
                  </div>

                  {env.deployment_type && (
                    <div>
                      <div className="text-xs text-gray-500 uppercase mb-1">Type</div>
                      <span className={`inline-block px-2 py-1 rounded text-xs ${getTypeColor(env.deployment_type)}`}>
                        {env.deployment_type}
                      </span>
                    </div>
                  )}

                  <div>
                    <div className="text-xs text-gray-500 uppercase mb-1">Version</div>
                    <div className="text-sm font-mono text-gray-900">
                      {env.version ? env.version.slice(0, 12) : 'Not deployed'}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-gray-500 uppercase mb-1">Branch</div>
                    <div className="text-sm text-gray-900">{env.branch || '-'}</div>
                  </div>

                  <div>
                    <div className="text-xs text-gray-500 uppercase mb-1">Deployed By</div>
                    <div className="text-sm text-gray-900">{env.deployed_by || '-'}</div>
                  </div>

                  {env.duration_seconds && (
                    <div>
                      <div className="text-xs text-gray-500 uppercase mb-1">Last Duration</div>
                      <div className="text-sm text-gray-900">{formatDuration(env.duration_seconds)}</div>
                    </div>
                  )}

                  {env.last_deployed_at && (
                    <div>
                      <div className="text-xs text-gray-500 uppercase mb-1">Last Deployed</div>
                      <div className="text-sm text-gray-900">
                        {new Date(env.last_deployed_at).toLocaleString()}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 text-sm text-gray-500 text-center">
          Auto-refreshing every 10 seconds • Last updated: {new Date().toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}
