import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '500', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    
    const result = await pool.query(
      'SELECT * FROM deployments ORDER BY started_at DESC LIMIT $1 OFFSET $2',
      [Math.min(limit, 1000), offset]
    );
    return NextResponse.json(result.rows);
  } catch (error) {
    console.error('Error fetching deployments:', error);
    return NextResponse.json(
      { error: 'Failed to fetch deployments' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      environment,
      status,
      deployment_type = 'standard',
      branch,
      version,
      requested_by,
      approved_by,
      tested_by,
      deployed_by,
      ticket_link,
      notes,
      started_at,
      completed_at,
      duration_seconds,
      duration, // legacy field
    } = body;

    const result = await pool.query(
      `INSERT INTO deployments (
        environment, status, deployment_type, branch, version, requested_by, approved_by, 
        tested_by, deployed_by, ticket_link, notes, started_at, 
        completed_at, duration_seconds
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *`,
      [
        environment,
        status,
        deployment_type,
        branch,
        version,
        requested_by,
        approved_by,
        tested_by,
        deployed_by,
        ticket_link,
        notes,
        started_at,
        completed_at,
        duration_seconds,
      ]
    );

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    console.error('Error creating deployment:', error);
    return NextResponse.json(
      { error: 'Failed to create deployment' },
      { status: 500 }
    );
  }
}
