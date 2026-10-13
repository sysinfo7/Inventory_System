import { NextResponse } from 'next/server';
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
  const user = await authenticate(email, password);
  return NextResponse.redirect(new URL(user ? '/' : '/login?error=1', request.url), 303);
}
