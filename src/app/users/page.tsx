import { requirePermission, type Role } from '@/lib/auth';
import { getDbPool } from '@/lib/db';
import { createUserAction, setUserActiveAction } from './actions';

type Props = { searchParams: Promise<{ error?: string; saved?: string }> };
const roleLabels: Record<Role, string> = { admin: 'Administrator', manager: 'Manager', clerk: 'Clerk', viewer: 'Read-only' };
const errors: Record<string, string> = {
  invalid: 'Check the email, display name, role, and password length.', duplicate: 'An account with that email already exists.',
  failed: 'The account could not be created.', self: 'You cannot deactivate your own account.',
  lastadmin: 'At least one active administrator account must remain.', missing: 'That account no longer exists.',
};

export default async function UsersPage({ searchParams }: Props) {
  await requirePermission('users:manage');
  const [users, params] = await Promise.all([
    getDbPool().query('SELECT id, email, display_name, role, active, created_at FROM app_users ORDER BY lower(display_name), id'),
    searchParams,
  ]);
  return <main className="page-shell">
    <div className="page-heading"><div><p className="eyebrow">ADMINISTRATION / ACCOUNTS</p><h1>User accounts</h1><p className="page-description">Create accounts and control who can access inventory workflows.</p></div></div>
    {params.error && <p className="form-alert" role="alert">{errors[params.error] ?? 'The request could not be completed.'}</p>}
    {params.saved === '1' && <p className="success-notice" role="status">Account change saved.</p>}
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
        <td data-label="Action"><form action={setUserActiveAction}><input type="hidden" name="userId" value={user.id} /><input type="hidden" name="active" value={user.active ? 'false' : 'true'} /><button className="table-action" type="submit">{user.active ? 'Deactivate' : 'Reactivate'}</button></form></td>
      </tr>)}</tbody></table></div>
    </section>
    <p className="catalog-footnote">You cannot deactivate your own account or the last active administrator. Deactivated accounts are denied access immediately on their next request.</p>
  </main>;
}
