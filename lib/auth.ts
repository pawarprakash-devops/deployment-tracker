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
