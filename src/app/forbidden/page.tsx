import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { requireUser } from '@/lib/auth';

export default function ForbiddenPage() {
  return <Suspense fallback={<main className="page-shell"><section className="loading-panel" aria-busy="true"><p>Checking account access…</p></section></main>}><ForbiddenContent /></Suspense>;
}

async function ForbiddenContent() {
  await connection();
  const user = await requireUser();
  return <main className="page-shell"><section className="unavailable-panel"><p className="eyebrow">ACCESS CONTROL</p><h1>Permission required</h1><p>Your {user.role} account does not have permission to open this page. Your access has not been changed.</p><Link href="/" className="button button-secondary">Return to overview</Link></section></main>;
}
