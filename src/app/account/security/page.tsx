import { connection } from 'next/server';
import { Suspense } from 'react';
import { requireUser } from '@/lib/auth';

type Props = { searchParams: Promise<{ error?: string; required?: string }> };

const errors: Record<string, string> = {
  invalid: 'Use a new password with at least 14 characters and enter it the same way twice.',
  incorrect: 'The current password is incorrect.',
  changed: 'The password changed in another request. Sign in again and retry.',
  limited: 'Too many password-change attempts. Wait before trying again.',
  proxy: 'Password change is temporarily unavailable. Please try again later.',
};

export default function AccountSecurityPage(props: Props) {
  return <Suspense fallback={<main className="page-shell"><section className="loading-panel" aria-busy="true"><p>Loading account security…</p></section></main>}><AccountSecurityContent searchParams={props.searchParams} /></Suspense>;
}

async function AccountSecurityContent({ searchParams }: Props) {
  await connection();
  const user = await requireUser({ allowPasswordChange: true });
  const params = await searchParams;

  return <main className="page-shell auth-shell">
    <section className="auth-panel" aria-labelledby="security-heading">
      <p className="eyebrow">ACCOUNT / SECURITY</p>
      <h1 id="security-heading">Change password</h1>
      {(user.passwordChangeRequired || params.required === '1') && <p className="demo-notice" role="status">An administrator set a temporary password for this account. Choose a new password to unlock inventory access.</p>}
      <p className="page-description">For {user.email}. Re-enter your current password to confirm this change.</p>
      {params.error && <p className="form-alert" role="alert">{errors[params.error] ?? 'The password could not be changed.'}</p>}
      <form action="/account/password/change" method="post" className="auth-form">
        <label className="form-field"><span>Current password</span><input name="currentPassword" type="password" autoComplete="current-password" maxLength={1024} required /></label>
        <label className="form-field"><span>New password</span><input name="newPassword" type="password" autoComplete="new-password" minLength={14} maxLength={1024} required /><small className="field-hint">Use at least 14 characters.</small></label>
        <label className="form-field"><span>Confirm new password</span><input name="confirmation" type="password" autoComplete="new-password" minLength={14} maxLength={1024} required /></label>
        <button className="button button-primary" type="submit">Change password</button>
      </form>
      <p className="catalog-footnote">Changing your password signs out all sessions, including this one. Sign in again with the new password.</p>
    </section>
  </main>;
}
