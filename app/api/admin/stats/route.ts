import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const sessionCookie = request.cookies.get('tracker_session')?.value;
    const adminToken = process.env.ADMIN_TOKEN || 'admin-change-me';
    
    if (sessionCookie !== adminToken) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get all deployments
    const deploymentsResult = await pool.query(`
      SELECT * FROM deployments 
      WHERE deployed_by NOT LIKE '%Deployment Tracker%' 
      OR deployed_by IS NULL
      ORDER BY started_at DESC
    `);
    
    const deployments = deploymentsResult.rows;
    
    // Calculate stats
    const totalDeployments = deployments.length;
    const successCount = deployments.filter(d => d.status === 'Success').length;
    const failureCount = deployments.filter(d => d.status === 'Failed').length;
    
    const successRate = totalDeployments > 0 ? (successCount / totalDeployments) * 100 : 0;
    const failureRate = totalDeployments > 0 ? (failureCount / totalDeployments) * 100 : 0;
    
    // Average duration
    const deploymentsWithDuration = deployments.filter(d => d.duration_seconds);
    const avgDuration = deploymentsWithDuration.length > 0
      ? deploymentsWithDuration.reduce((sum, d) => sum + d.duration_seconds, 0) / deploymentsWithDuration.length
      : 0;
    
    // Today and this week
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    const deploymentsToday = deployments.filter(d => new Date(d.started_at) >= todayStart).length;
    const deploymentsThisWeek = deployments.filter(d => new Date(d.started_at) >= weekStart).length;
    
    // By environment
    const byEnvironment: Record<string, number> = {};
    deployments.forEach(d => {
      byEnvironment[d.environment] = (byEnvironment[d.environment] || 0) + 1;
    });
    
    // By status
    const byStatus: Record<string, number> = {};
    deployments.forEach(d => {
      byStatus[d.status] = (byStatus[d.status] || 0) + 1;
    });
    
    // Recent failures (last 10)
    const recentFailures = deployments
      .filter(d => d.status === 'Failed')
      .slice(0, 10)
      .map(d => ({
        environment: d.environment,
        branch: d.branch || d.frontend_branch || d.backend_branch,
        started_at: d.started_at,
        notes: d.notes
      }));
    
    // Slowest deployments (top 10)
    const slowestDeployments = deployments
      .filter(d => d.duration_seconds)
      .sort((a, b) => b.duration_seconds - a.duration_seconds)
      .slice(0, 10)
      .map(d => ({
        environment: d.environment,
        duration_seconds: d.duration_seconds,
        started_at: d.started_at,
        branch: d.branch || d.frontend_branch || d.backend_branch
      }));
    
    // Most active users
    const mostActiveUsers: Record<string, number> = {};
    deployments.forEach(d => {
      const user = d.requested_by || d.deployed_by || 'Unknown';
      mostActiveUsers[user] = (mostActiveUsers[user] || 0) + 1;
    });
    
    return NextResponse.json({
      totalDeployments,
      successRate,
      failureRate,
      avgDuration,
      deploymentsToday,
      deploymentsThisWeek,
      byEnvironment,
      byStatus,
      recentFailures,
      slowestDeployments,
      mostActiveUsers
    });
  } catch (error) {
    console.error('Error fetching admin stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}
