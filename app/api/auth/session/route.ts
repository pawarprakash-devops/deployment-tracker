import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const sessionCookie = request.cookies.get('tracker_session')?.value;
  const adminToken = process.env.ADMIN_TOKEN || 'admin-change-me';
  
  const isAuthenticated = sessionCookie === adminToken;
  
  return NextResponse.json({ 
    authenticated: isAuthenticated,
    role: isAuthenticated ? 'admin' : 'viewer'
  });
}
