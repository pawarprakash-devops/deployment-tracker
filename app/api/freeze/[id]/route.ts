import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { isAdminRequest } from '@/lib/auth';
import { ensureFreezeTable } from '@/lib/freeze';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// DELETE /api/freeze/:id (admin): cancels a freeze window (kept for history, no longer shown or enforced).
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Admin login required' }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  try {
    await ensureFreezeTable();
    const r = await pool.query(`UPDATE freeze_windows SET cancelled_at = now() WHERE id = $1 AND cancelled_at IS NULL RETURNING id`, [id]);
    return r.rowCount ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Not found or already cancelled' }, { status: 404 });
  } catch (e) {
    console.error('freeze DELETE:', e);
    return NextResponse.json({ error: 'Failed to cancel freeze window' }, { status: 500 });
  }
}
