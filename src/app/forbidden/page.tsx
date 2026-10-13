import Link from 'next/link';
import { requireUser } from '@/lib/auth';

export default async function ForbiddenPage() {
  const user = await requireUser();
  return <main className="page-shell"><section className="unavailable-panel"><p className="eyebrow">ACCESS CONTROL</p><h1>Permission required</h1><p>Your {user.role} account does not have permission to open this page. Your access has not been changed.</p><Link href="/" className="button button-secondary">Return to overview</Link></section></main>;
}
