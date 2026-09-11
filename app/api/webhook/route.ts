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

    // Auto-normalize environment & cluster name
    function normalizeEnvironment(
      rawEnv?: string,
      noteText?: string,
      branchName?: string,
      feBranch?: string,
      beBranch?: string
    ): { name: string; isProduction: boolean } {
      const combined = `${rawEnv || ''} ${noteText || ''} ${branchName || ''} ${feBranch || ''} ${beBranch || ''}`.toLowerCase();
      
      if (/staging-euw2|stage-euw2|euw2/.test(combined)) {
        return { name: 'Stage EUW2', isProduction: false };
      }
      if (/staging-use1|stage-use1|use1/.test(combined)) {
        return { name: 'Stage USE1', isProduction: false };
      }
      if (/preview-99999|preview/.test(combined) && !/stage|pre-prod|preprod/.test((rawEnv || '').toLowerCase())) {
        return { name: 'Preview', isProduction: false };
      }
      if (/qa-aps|qa/.test(combined) && !/stage|pre-prod|preprod|prod/.test((rawEnv || '').toLowerCase())) {
        return { name: 'QA', isProduction: false };
      }
      if (/pre-prod-usw|preprod-usw|preprod_usw/.test(combined)) {
        return { name: 'Pre-Prod USW', isProduction: false };
      }
      if (/pre-prod|preprod/.test(combined)) {
        return { name: 'Pre-Prod', isProduction: false };
      }
      if (/prod-ank|prod_ank|ankura/.test(combined)) {
        return { name: 'Production (Ankura)', isProduction: true };
      }
      if (/prod-neo|prod_neo|neotia|babyjoy/.test(combined)) {
        return { name: 'Production (Neotia/Babyjoy)', isProduction: true };
      }
      if (/prod-refera|refera/.test(combined)) {
        return { name: 'Production (Refera)', isProduction: true };
      }
      if (/production|prod/.test(combined) && !/pre-prod|preprod/.test(combined)) {
        return { name: 'Production', isProduction: true };
      }
      if (/stage|staging/.test(combined)) {
        return { name: 'Stage', isProduction: false };
      }
      if (/lms/.test(combined)) {
        return { name: 'LMS', isProduction: false };
      }

      if (rawEnv && rawEnv !== 'Other') {
        const cleaned = rawEnv.replace(/[-_]ecs.*$/i, '').replace(/[-_]cluster$/i, '');
        const isProd = /prod/i.test(rawEnv) && !/pre-prod|preprod/i.test(rawEnv);
        return { name: cleaned, isProduction: isProd };
      }

      return { name: 'Other', isProduction: false };
    }

    const resolved = normalizeEnvironment(
      environment,
      notes,
      branch,
      frontend_branch,
      backend_branch
    );
    const targetEnv = resolved.name;
    const isProdEnv = resolved.isProduction;

    // Auto-create environment if it doesn't exist
    const envCheck = await pool.query(
      'SELECT id FROM environments WHERE name = $1',
      [targetEnv]
    );

    if (envCheck.rows.length === 0) {
      const maxOrder = await pool.query(
        'SELECT COALESCE(MAX(display_order), 0) + 1 as next_order FROM environments'
      );
      const nextOrder = maxOrder.rows[0].next_order;
      
      await pool.query(
        `INSERT INTO environments (name, is_production, display_order) 
         VALUES ($1, $2, $3)`,
        [targetEnv, isProdEnv, nextOrder]
      );
      console.log(`✅ Auto-created environment: ${targetEnv} (is_production: ${isProdEnv})`);
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
        targetEnv,
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
      { 
        error: 'Failed to process webhook',
        details: error instanceof Error ? error.message : String(error)
      },
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
