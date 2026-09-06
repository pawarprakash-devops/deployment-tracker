import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import pool from '@/lib/db';

export async function GET(request: Request) {
  try {
    const result = await pool.query(
      'SELECT * FROM environments ORDER BY display_order'
    );
    const json = JSON.stringify(result.rows);
    const tag = `"${createHash('sha1').update(json).digest('hex')}"`;
    if (request.headers.get('if-none-match') === tag) {
      return new NextResponse(null, { status: 304, headers: { ETag: tag } });
    }
    return new NextResponse(json, {
      status: 200,
      headers: { ETag: tag, 'Cache-Control': 'no-cache', 'Content-Type': 'application/json' },
    });
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
