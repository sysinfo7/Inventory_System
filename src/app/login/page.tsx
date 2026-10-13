import { connection } from 'next/server';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';

type Props = { searchParams: Promise<{ error?: string }> };

export default function LoginPage(props: Props) {
  return <Suspense fallback={<main className="page-shell"><section className="loading-panel"><h1>Sign in</h1><p>Loading sign-in…</p></section></main>}><LoginContent {...props} /></Suspense>;
}

async function LoginContent({ searchParams }: Props) {
  await connection();
  if (await currentUser()) redirect('/');
  const params = await searchParams;
  return <main className="page-shell auth-shell">
    <section className="auth-panel" aria-labelledby="login-heading">
      <p className="eyebrow">RETAIL OPERATIONS / SECURE ACCESS</p>
      <h1 id="login-heading">Welcome back.</h1>
      <p className="page-description">Sign in with your inventory account to continue.</p>
      {params.error === '1' && <p className="form-alert" role="alert">Email or password is incorrect, or this account is inactive.</p>}
      <form action="/login/authenticate" method="post" className="auth-form">
        <label className="form-field"><span>Email address</span><input name="email" type="email" autoComplete="username" maxLength={254} required /></label>
        <label className="form-field"><span>Password</span><input name="password" type="password" autoComplete="current-password" maxLength={1024} required /></label>
        <button className="button button-primary" type="submit">Sign in <span aria-hidden="true">→</span></button>
      </form>
      <p className="catalog-footnote">The local administrator is created with <code>npm run auth:bootstrap</code>. No shared demo password is enabled by default.</p>
    </section>
  </main>;
}
