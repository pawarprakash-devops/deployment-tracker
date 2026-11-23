import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { isAdminRequest } from '@/lib/auth';
import { ensureFreezeTable, MAX_FREEZE_DAYS } from '@/lib/freeze';

export const dynamic = 'force-dynamic';

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null);

// GET /api/freeze: freeze windows that end in the future or ended in the last 90 days (for history badges).
export async function GET() {
  try {
    await ensureFreezeTable();
    const r = await pool.query(
      `SELECT id, environment, starts_at, ends_at, reason, created_by, created_at,
              (starts_at <= now() AND ends_at > now()) AS active
       FROM freeze_windows
       WHERE cancelled_at IS NULL AND ends_at > now() - interval '90 days'
       ORDER BY starts_at`,
    );
    return NextResponse.json({ windows: r.rows, now: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('freeze GET:', e);
    return NextResponse.json({ error: 'Failed to load freeze windows' }, { status: 500 });
  }
}

// POST /api/freeze (admin) { environment: "*" | name, starts_at, ends_at (ISO), reason, created_by }
export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Admin login required' }, { status: 401 });
  let b: Record<string, unknown>;
  try { b = await request.json(); } catch { return NextResponse.json({ error: 'JSON body required' }, { status: 400 }); }
  const environment = str(b.environment, 120);
  const reason = str(b.reason, 300);
  const createdBy = str(b.created_by, 80);
  const start = Date.parse(String(b.starts_at)), end = Date.parse(String(b.ends_at));
  if (!environment) return NextResponse.json({ error: 'Pick an environment (or all)' }, { status: 400 });
  if (!reason) return NextResponse.json({ error: 'Give a reason, e.g. "Clinic hours" or "Release weekend"' }, { status: 400 });
  if (!createdBy) return NextResponse.json({ error: 'Your name is required' }, { status: 400 });
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return NextResponse.json({ error: 'End must be after start' }, { status: 400 });
  if (end - start > MAX_FREEZE_DAYS * 86_400_000) return NextResponse.json({ error: `A freeze can be at most ${MAX_FREEZE_DAYS} days` }, { status: 400 });
  if (end < Date.now()) return NextResponse.json({ error: 'That window is already over' }, { status: 400 });
  try {
    await ensureFreezeTable();
    const r = await pool.query(
      `INSERT INTO freeze_windows (environment, starts_at, ends_at, reason, created_by) VALUES ($1,$2,$3,$4,$5)
       RETURNING id, environment, starts_at, ends_at, reason, created_by, created_at`,
      [environment, new Date(start).toISOString(), new Date(end).toISOString(), reason, createdBy],
    );
    return NextResponse.json({ window: r.rows[0] }, { status: 201 });
  } catch (e) {
    console.error('freeze POST:', e);
    return NextResponse.json({ error: 'Failed to save freeze window' }, { status: 500 });
  }
}
