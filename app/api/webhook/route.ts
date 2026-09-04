import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    // Verify authorization (simple token-based auth)
    const authHeader = request.headers.get('authorization');
    const expectedToken = process.env.WEBHOOK_SECRET || 'change-me-in-production';
    
    if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    
    // Extract deployment info from webhook payload
    const {
      environment,
      status,
      deployment_type = 'standard',
      branch,
      version,
      frontend_branch,
      backend_branch,
      frontend_version,
      backend_version,
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

    // Validate required fields
    if (!environment || !status || !started_at) {
      return NextResponse.json(
        { error: 'Missing required fields: environment, status, started_at' },
        { status: 400 }
      );
    }

    // Auto-create environment if it doesn't exist
    const envCheck = await pool.query(
      'SELECT id FROM environments WHERE name = $1',
      [environment]
    );

    if (envCheck.rows.length === 0) {
      const maxOrder = await pool.query(
        'SELECT COALESCE(MAX(display_order), 0) + 1 as next_order FROM environments'
      );
      const nextOrder = maxOrder.rows[0].next_order;
      
      await pool.query(
        `INSERT INTO environments (name, is_production, display_order) 
         VALUES ($1, false, $2)`,
        [environment, nextOrder]
      );
      console.log(`✅ Auto-created environment: ${environment}`);
    }

    // Auto-calculate duration if completed_at is provided and duration_seconds is not
    let calculatedDuration = duration_seconds;
    if (completed_at && !duration_seconds) {
      const startTime = new Date(started_at).getTime();
      const endTime = new Date(completed_at).getTime();
      calculatedDuration = Math.round((endTime - startTime) / 1000);
    }

    // Insert deployment
    const result = await pool.query(
      `INSERT INTO deployments (
        environment, 
        status,
        deployment_type,
        branch, 
        version,
        frontend_branch,
        backend_branch,
        frontend_version,
        backend_version,
        requested_by, 
        approved_by,
        tested_by,
        deployed_by,
        ticket_link,
        notes,
        started_at, 
        completed_at, 
        duration_seconds
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING *`,
      [
        environment,
        status,
        deployment_type,
        branch,
        version,
        frontend_branch,
        backend_branch,
        frontend_version,
        backend_version,
        requested_by,
        approved_by,
        tested_by,
        deployed_by,
        ticket_link,
        notes,
        started_at,
        completed_at,
        calculatedDuration,
      ]
    );

    console.log('✅ Deployment logged:', {
      id: result.rows[0].id,
      environment,
      status,
      requested_by,
    });

    return NextResponse.json({
      success: true,
      deployment: result.rows[0],
    }, { status: 201 });

  } catch (error) {
    console.error('❌ Webhook error:', error);
    return NextResponse.json(
      { error: 'Failed to process webhook' },
      { status: 500 }
    );
  }
}

// Health check endpoint
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: 'Deployment tracker webhook endpoint',
    usage: 'POST with deployment data and Authorization header',
  });
}
