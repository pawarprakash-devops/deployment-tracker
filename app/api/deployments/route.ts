import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET() {
  try {
    const result = await pool.query(
      'SELECT * FROM deployments ORDER BY started_at DESC LIMIT 100'
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
    } = body;

    const result = await pool.query(
      `INSERT INTO deployments (
        environment, status, branch, version, requested_by, approved_by, 
        tested_by, deployed_by, ticket_link, notes, started_at, 
        completed_at, duration_seconds
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        environment,
        status,
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
