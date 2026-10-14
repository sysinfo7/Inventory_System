import { NextResponse } from 'next/server';
import { isIP } from 'node:net';
import { authenticate } from '@/lib/auth';

export async function POST(request: Request) {
  // Same-origin check also protects this credential endpoint from cross-site form posts.
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host || new URL(origin).host !== host) return new Response('Forbidden', { status: 403 });
  const form = await request.formData();
  const email = form.get('email');
  const password = form.get('password');
  if (typeof email !== 'string' || typeof password !== 'string') return NextResponse.redirect(new URL('/login?error=1', request.url), 303);

  // Only trust a proxy address when the operator explicitly configures a proxy that overwrites this header.
  let clientAddress = 'local';
  if (process.env.AUTH_TRUST_PROXY_HEADERS === 'true') {
    const forwardedAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    if (!forwardedAddress || !isIP(forwardedAddress)) {
      return NextResponse.redirect(new URL('/login?error=3', request.url), 303);
    }
    clientAddress = forwardedAddress;
  }

  const result = await authenticate(email, password, clientAddress);
  if (result.rateLimited) {
    const response = NextResponse.redirect(new URL('/login?error=2', request.url), 303);
    response.headers.set('Retry-After', String(result.retryAfterSeconds ?? 900));
    return response;
  }
  const destination = result.user
    ? (result.user.passwordChangeRequired ? '/account/security?required=1' : '/')
    : '/login?error=1';
  return NextResponse.redirect(new URL(destination, request.url), 303);
}
