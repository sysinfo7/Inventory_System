import { NextResponse } from 'next/server';
import { revokeCurrentSession } from '@/lib/auth';

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host || new URL(origin).host !== host) return new Response('Forbidden', { status: 403 });
  await revokeCurrentSession();
  return NextResponse.redirect(new URL('/login', request.url), 303);
}
