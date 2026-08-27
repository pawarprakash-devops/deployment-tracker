import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET() {
  try {
    const result = await pool.query(
      'SELECT * FROM environments ORDER BY display_order'
    );
    return NextResponse.json(result.rows);
  } catch (error) {
    console.error('Error fetching environments:', error);
    return NextResponse.json(
      { error: 'Failed to fetch environments' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, is_production, display_order } = body;

    const result = await pool.query(
      `INSERT INTO environments (name, is_production, display_order) 
       VALUES ($1, $2, $3) RETURNING *`,
      [name, is_production, display_order]
    );

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    console.error('Error creating environment:', error);
    return NextResponse.json(
      { error: 'Failed to create environment' },
      { status: 500 }
    );
  }
}
