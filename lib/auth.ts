import type { NextRequest } from 'next/server';

// Same check as middleware.ts uses for write routes. Use it in GET routes that return internal data
// (middleware lets every GET through).
export function isAdminRequest(request: NextRequest | Request): boolean {
  const adminToken = process.env.ADMIN_TOKEN || 'admin-change-me';
  const cookie = 'cookies' in request
    ? (request as NextRequest).cookies.get('tracker_session')?.value
    : /(?:^|;\s*)tracker_session=([^;]+)/.exec(request.headers.get('cookie') || '')?.[1];
  return cookie === adminToken || request.headers.get('authorization') === `Bearer ${adminToken}`;
}

// Jira read access (the Tickets tab and its /api/jira/* routes). Public by default so everyone can see it;
// set JIRA_PUBLIC_READ=false in the environment to require an admin session again (no code change needed).
export const jiraPublicRead = (): boolean => (process.env.JIRA_PUBLIC_READ || '').trim().toLowerCase() !== 'false';

export function canReadJira(request: NextRequest | Request): boolean {
  return jiraPublicRead() || isAdminRequest(request);
}
