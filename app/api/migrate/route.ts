import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function POST() {
  try {
    // Add new columns
    await pool.query(`
      ALTER TABLE deployments 
      ADD COLUMN IF NOT EXISTS frontend_branch TEXT,
      ADD COLUMN IF NOT EXISTS backend_branch TEXT,
      ADD COLUMN IF NOT EXISTS frontend_version TEXT,
      ADD COLUMN IF NOT EXISTS backend_version TEXT
    `);

    // Migrate existing data
    await pool.query(`
      UPDATE deployments 
      SET frontend_branch = branch,
          frontend_version = version
      WHERE (notes LIKE '%frontend%' OR notes LIKE '%Component: frontend%')
        AND frontend_branch IS NULL
    `);

    await pool.query(`
      UPDATE deployments 
      SET backend_branch = branch,
          backend_version = version
      WHERE (notes LIKE '%backend%' OR notes LIKE '%Component: backend%')
        AND backend_branch IS NULL
    `);

    await pool.query(`
      UPDATE deployments 
      SET frontend_branch = branch,
          backend_branch = branch,
          frontend_version = version,
          backend_version = version
      WHERE notes LIKE '%both%'
        AND frontend_branch IS NULL
        AND backend_branch IS NULL
    `);

    // Create index
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_deployments_fe_be 
      ON deployments(frontend_branch, backend_branch)
    `);

    return NextResponse.json({ 
      success: true, 
      message: 'Migration completed successfully' 
    });
  } catch (error) {
    console.error('Migration error:', error);
    return NextResponse.json(
      { error: 'Migration failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    // 1. Ensure 'Stage EUW2' exists in environments table
    const envCheck = await pool.query("SELECT id FROM environments WHERE name = 'Stage EUW2'");
    if (envCheck.rows.length === 0) {
      await pool.query(
        "INSERT INTO environments (name, is_production, display_order) VALUES ('Stage EUW2', false, 4) ON CONFLICT DO NOTHING"
      );
    }

    // 2. Widen any VARCHAR columns in deployments to TEXT to prevent "value too long for type character varying(100)"
    await pool.query(`
      ALTER TABLE deployments 
        ALTER COLUMN requested_by TYPE TEXT,
        ALTER COLUMN approved_by TYPE TEXT,
        ALTER COLUMN tested_by TYPE TEXT,
        ALTER COLUMN deployed_by TYPE TEXT,
        ALTER COLUMN branch TYPE TEXT,
        ALTER COLUMN version TYPE TEXT,
        ALTER COLUMN ticket_link TYPE TEXT,
        ALTER COLUMN notes TYPE TEXT,
        ALTER COLUMN environment TYPE TEXT;
    `);

    // 3. Check if QA run 34578209268 exists, and insert it if missing
    const runCheck = await pool.query(
      "SELECT id FROM deployments WHERE ticket_link LIKE '%34578209268%'"
    );

    let insertedQA = null;
    if (runCheck.rows.length === 0) {
      const insertRes = await pool.query(`
        INSERT INTO deployments (
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
        ) VALUES (
          'QA',
          'Success',
          'standard',
          'qa',
          'qa',
          'qa',
          'qa',
          'qa',
          'qa',
          'Prajwal-2605, pawarprakash-devops, vaibhavginnalwar, Prashantl1901, prajwalbonde001, dev-prafulk, krishna-vidai, saranya13-tech, ChetanPawarVidaiSolutions, TejasSaxenaVD',
          NULL,
          NULL,
          'GitHub Actions',
          'https://github.com/vidaisolutions/vidai-devops/actions/runs/34578209268',
          'Component: both_frontend_and_backend · Pipeline: Full Deploy v2 · PR #FE#2640, FE#2636, FE#2632, FE#2631, FE#2629, FE#2627, FE#2625, FE#2623, BE#2710, BE#2706, BE#2703, BE#2701, BE#2698, BE#2696, BE#2694',
          '2026-09-11T08:14:38Z',
          '2026-09-11T08:21:16Z',
          398
        ) RETURNING *;
      `);
      insertedQA = insertRes.rows[0];
    }

    // 4. Return column schemas and migration result
    const cols = await pool.query(
      "SELECT column_name, data_type, character_maximum_length FROM information_schema.columns WHERE table_name = 'deployments' ORDER BY ordinal_position"
    );

    return NextResponse.json({
      success: true,
      insertedQA,
      columns: cols.rows,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

