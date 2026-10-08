import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

// Whole-table counts for the Delivery pulse card. /api/deployments is capped at 1000 rows, so
// anything derived from it (total runs, success rate, rollbacks, 14-day bars) stops growing at 1000.
// Same exclusion as the other routes: the tracker's own deployments are not counted.
const BASE = `deployments WHERE deployed_by IS NULL OR deployed_by NOT LIKE '%Deployment Tracker%'`;
const SUCCESS = `status ~* '(^|\\s)success$'`;
const FAILED = `status ~* 'fail'`;
const TODAY_UTC = `(now() AT TIME ZONE 'UTC')::date`;
const DAY_UTC = `(started_at AT TIME ZONE 'UTC')::date`;

export async function GET() {
  try {
    const [totals, days, latest] = await Promise.all([
      pool.query(`
        WITH d AS (SELECT * FROM ${BASE})
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE ${SUCCESS})::int AS success,
               count(*) FILTER (WHERE ${FAILED})::int AS failed,
               count(*) FILTER (WHERE status ~* 'roll' OR notes ~* 'rollback')::int AS rollbacks,
               count(*) FILTER (WHERE ${DAY_UTC} = ${TODAY_UTC})::int AS today
        FROM d`),
      pool.query(`
        WITH d AS (SELECT * FROM ${BASE})
        SELECT to_char(g, 'YYYY-MM-DD') AS date,
               count(d.status) FILTER (WHERE d.${SUCCESS})::int AS success,
               count(d.status) FILTER (WHERE d.${FAILED})::int AS failed,
               count(d.status)::int AS total
        FROM generate_series(${TODAY_UTC} - 13, ${TODAY_UTC}, interval '1 day') AS g
        LEFT JOIN d ON (d.started_at AT TIME ZONE 'UTC')::date = g::date
        GROUP BY g ORDER BY g`),
      pool.query(`
        SELECT DISTINCT ON (environment) environment, status
        FROM ${BASE} ORDER BY environment, started_at DESC`),
    ]);
    const t = totals.rows[0];
    return NextResponse.json(
      {
        ...t,
        days: days.rows.map((r) => ({ ...r, other: r.total - r.success - r.failed })),
        latest: latest.rows,
      },
      { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' } }
    );
  } catch (error) {
    console.error('summary error:', error);
    return NextResponse.json({ error: 'Failed to build summary' }, { status: 500 });
  }
}
