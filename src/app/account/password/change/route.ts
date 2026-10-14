import { NextResponse } from 'next/server';
import { isIP } from 'node:net';
import { changeCurrentPassword, reserveCurrentPasswordAttempt, revokeCurrentSession } from '@/lib/auth';

function redirectTo(request: Request, path: string) {
  return NextResponse.redirect(new URL(path, request.url), 303);
}

export async function POST(request: Request) {
  // Match the sign-in endpoint's origin check to reject cross-site form posts.
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host || new URL(origin).host !== host) return new Response('Forbidden', { status: 403 });

  const form = await request.formData();
  const currentPassword = form.get('currentPassword');
  const newPassword = form.get('newPassword');
  const confirmation = form.get('confirmation');
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || typeof confirmation !== 'string'
      || currentPassword.length > 1024 || newPassword.length < 14 || newPassword.length > 1024
      || newPassword !== confirmation) {
    return redirectTo(request, '/account/security?error=invalid');
  }

  // Trust a forwarded address only when a configured proxy replaces the header.
  let clientAddress = 'local';
  if (process.env.AUTH_TRUST_PROXY_HEADERS === 'true') {
    const forwardedAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    if (!forwardedAddress || !isIP(forwardedAddress)) return redirectTo(request, '/account/security?error=proxy');
    clientAddress = forwardedAddress;
  }

  const attempt = await reserveCurrentPasswordAttempt(clientAddress);
  if (!attempt.authenticated) return redirectTo(request, '/login');
  if (!attempt.allowed) {
    const response = redirectTo(request, '/account/security?error=limited');
    response.headers.set('Retry-After', String(attempt.retryAfterSeconds || 900));
    return response;
  }

  const result = await changeCurrentPassword(currentPassword, newPassword, clientAddress);
  if (result === 'session') return redirectTo(request, '/login');
  if (result === 'incorrect') return redirectTo(request, '/account/security?error=incorrect');
  if (result === 'same') return redirectTo(request, '/account/security?error=invalid');

  // The database trigger has already revoked every session and recorded the event.
  await revokeCurrentSession();
  return redirectTo(request, '/login?passwordChanged=1');
}
