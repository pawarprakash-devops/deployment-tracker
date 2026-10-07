import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest, jiraConfigured, jiraIssuesByKeys } from '@/lib/jira';

export const dynamic = 'force-dynamic';

// GET /api/jira/issues?keys=CORE-1,CORE-2  (admin session required)
export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: 'Admin login required' }, { status: 401 });
  if (!jiraConfigured()) return NextResponse.json({ configured: false, issues: {} });
  try {
    const keys = (new URL(request.url).searchParams.get('keys') || '').split(',').map((k) => k.trim().toUpperCase());
    const issues = await jiraIssuesByKeys(keys);
    return NextResponse.json({ configured: true, issues }, { headers: { 'Cache-Control': 'private, max-age=120' } });
  } catch (e) {
    return NextResponse.json({ configured: true, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
