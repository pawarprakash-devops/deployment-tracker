import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/auth';
import { buildPipeline } from '@/lib/pipeline';

export const dynamic = 'force-dynamic';

// Tickets grouped by environment. Deployment data is public like the other GETs; Jira fields
// (summary, assignee, status) are only attached for an admin session (see docs/redesign/02-API-SPEC.md).
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sinceDays = Math.trunc(Number(searchParams.get('sinceDays'))) || 30;
    const jira = isAdminRequest(request);
    const body = await buildPipeline({ jira, sinceDays });
    return NextResponse.json(body, {
      headers: { 'Cache-Control': jira ? 'private, max-age=30' : 'public, s-maxage=30, stale-while-revalidate=60' },
    });
  } catch (error) {
    console.error('pipeline error:', error);
    return NextResponse.json({ error: 'Failed to build pipeline' }, { status: 500 });
  }
}
