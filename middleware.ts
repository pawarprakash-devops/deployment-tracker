import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Webhook endpoint - requires webhook secret (handled in webhook route)
  if (pathname === '/api/webhook') {
    return NextResponse.next();
  }

  // Auth endpoints - always allow
  if (pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  // All GET requests are public (no auth required for viewing)
  if (request.method === 'GET') {
    return NextResponse.next();
  }

  // Protected routes (require auth for POST/PUT/DELETE)
  const protectedMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
  if (protectedMethods.includes(request.method)) {
    const authHeader = request.headers.get('authorization');
    const sessionCookie = request.cookies.get('tracker_session')?.value;
    
    // Check for admin token or session
    const adminToken = process.env.ADMIN_TOKEN || 'admin-change-me';
    
    if (authHeader === `Bearer ${adminToken}` || sessionCookie === adminToken) {
      return NextResponse.next();
    }
    
    // Unauthorized for modifications
    return NextResponse.json(
      { error: 'Unauthorized - Admin login required to make changes' },
      { status: 401 }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
