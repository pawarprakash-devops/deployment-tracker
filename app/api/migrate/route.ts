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
