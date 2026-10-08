import { NextResponse } from 'next/server';
import { jiraPublicRead } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Tells the Tickets page whether Jira data is readable without signing in (JIRA_PUBLIC_READ, default true).
// No Jira call and no secrets: it only reports the flag.
export async function GET() {
  return NextResponse.json({ public: jiraPublicRead() }, { headers: { 'Cache-Control': 'no-store' } });
}
