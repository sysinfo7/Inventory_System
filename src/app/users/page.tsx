import { connection } from 'next/server';
import { Suspense } from 'react';
import { requirePermission, type Role } from '@/lib/auth';
import { getDbPool } from '@/lib/db';
import { createUserAction, setUserActiveAction } from './actions';

type Props = { searchParams: Promise<{ error?: string; saved?: string }> };
const roleLabels: Record<Role, string> = { admin: 'Administrator', manager: 'Manager', clerk: 'Clerk', viewer: 'Read-only' };
const errors: Record<string, string> = {
  invalid: 'Check the email, display name, role, and password length.', duplicate: 'An account with that email already exists.',
  failed: 'The account could not be created.', self: 'You cannot deactivate your own account.',
  lastadmin: 'At least one active administrator account must remain.', missing: 'That account no longer exists.',
  resetinvalid: 'Enter the same temporary password twice. It must be at least 14 characters.',
  selfreset: 'Use a different administrator account to reset your password.',
  resettarget: 'Only an active account can have its password reset.',
  resetfailed: 'The password could not be reset. No change was saved.',
};

export default function UsersPage(props: Props) {
  return <Suspense fallback={<main className="page-shell"><section className="loading-panel" aria-busy="true"><p>Loading user accounts…</p></section></main>}><UsersContent searchParams={props.searchParams} /></Suspense>;
}

async function UsersContent({ searchParams }: Props) {
  await connection();
  await requirePermission('users:manage');
  const [users, params] = await Promise.all([
    getDbPool().query('SELECT id, email, display_name, role, active, created_at FROM app_users ORDER BY lower(display_name), id'),
    searchParams,
  ]);
  return <main className="page-shell">
    <div className="page-heading"><div><p className="eyebrow">ADMINISTRATION / ACCOUNTS</p><h1>User accounts</h1><p className="page-description">Create accounts and control who can access inventory workflows.</p></div></div>
    {params.error && <p className="form-alert" role="alert">{errors[params.error] ?? 'The request could not be completed.'}</p>}
    {params.saved === '1' && <p className="success-notice" role="status">Account change saved.</p>}
    {params.saved === 'reset' && <p className="success-notice" role="status">Temporary password set. The user must choose a new password at their next sign-in.</p>}
    <section className="editor-panel user-create-panel"><h2>Create account</h2><p className="field-hint">Use a unique password with at least 14 characters. Share it securely with the account owner.</p>
      <form action={createUserAction} className="user-create-form">
        <label className="form-field"><span>Email</span><input name="email" type="email" maxLength={254} autoComplete="off" required /></label>
        <label className="form-field"><span>Display name</span><input name="displayName" maxLength={120} required /></label>
        <label className="form-field"><span>Role</span><select name="role" defaultValue="viewer">{Object.entries(roleLabels).map(([role, label]) => <option value={role} key={role}>{label}</option>)}</select></label>
        <label className="form-field"><span>Temporary password</span><input name="password" type="password" minLength={14} maxLength={1024} autoComplete="new-password" required /></label>
        <button className="button button-primary" type="submit">Create account</button>
      </form>
    </section>
    <section className="catalog-panel user-list-panel"><div className="catalog-toolbar"><div><h2>Existing accounts</h2><p>{users.rowCount} accounts</p></div></div>
      <div className="table-scroll"><table className="product-table user-table"><thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead><tbody>{users.rows.map((user) => <tr key={user.id}>
        <td data-label="Name">{user.display_name}</td><td data-label="Email">{user.email}</td><td data-label="Role">{roleLabels[user.role as Role]}</td>
        <td data-label="Status"><span className={`status-pill ${user.active ? 'status-active' : 'status-inactive'}`}>{user.active ? 'Active' : 'Inactive'}</span></td>
        <td data-label="Action"><div className="user-row-actions">
          <form action={setUserActiveAction}><input type="hidden" name="userId" value={user.id} /><input type="hidden" name="active" value={user.active ? 'false' : 'true'} /><button className="table-action" type="submit">{user.active ? 'Deactivate' : 'Reactivate'}</button></form>
          {user.active && <details className="user-reset-details"><summary className="table-action">Reset password</summary>
            <form action="/users/password-reset" method="post" className="user-reset-form">
              <input type="hidden" name="userId" value={user.id} />
              <label className="form-field"><span>Temporary password</span><input name="temporaryPassword" type="password" autoComplete="new-password" minLength={14} maxLength={1024} required /></label>
              <label className="form-field"><span>Confirm temporary password</span><input name="confirmation" type="password" autoComplete="new-password" minLength={14} maxLength={1024} required /></label>
              <p className="field-hint">Share it securely outside this app. The user must replace it before opening inventory pages.</p>
              <button className="button button-secondary" type="submit">Set temporary password</button>
            </form>
          </details>}
        </div></td>
      </tr>)}</tbody></table></div>
    </section>
    <p className="catalog-footnote">You cannot deactivate your own account or the last active administrator. Deactivated accounts are denied access immediately on their next request.</p>
  </main>;
}
