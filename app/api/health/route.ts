import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Get the latest successful deployment for each environment
    const result = await pool.query(`
      WITH latest_deployments AS (
        SELECT DISTINCT ON (environment)
          environment,
          status,
          deployment_type,
          branch,
          version,
          deployed_by,
          started_at,
          completed_at,
          duration_seconds,
          created_at
        FROM deployments
        WHERE status = 'Success'
        ORDER BY environment, started_at DESC
      )
      SELECT 
        e.id,
        e.name as environment,
        e.is_production,
        e.display_order,
        ld.status,
        ld.deployment_type,
        ld.branch,
        ld.version,
        ld.deployed_by,
        ld.started_at as last_deployed_at,
        ld.completed_at,
        ld.duration_seconds
      FROM environments e
      LEFT JOIN latest_deployments ld ON e.name = ld.environment
      ORDER BY e.display_order
    `);

    return NextResponse.json(result.rows);
  } catch (error) {
    console.error('Error fetching environment health:', error);
    return NextResponse.json(
      { error: 'Failed to fetch environment health' },
      { status: 500 }
    );
  }
}
