import { requireUser, type Permission, type Role, hasPermission } from '@/lib/auth';

const roles: Array<{ id: Role; label: string; description: string }> = [
  { id: 'admin', label: 'Administrator', description: 'Full inventory access and user administration.' },
  { id: 'manager', label: 'Manager', description: 'Manage products and stock, review activity.' },
  { id: 'clerk', label: 'Clerk', description: 'View inventory and record receiving or sales deductions.' },
  { id: 'viewer', label: 'Read-only', description: 'Review products, stock, and activity without changes.' },
];
const permissions: Array<{ id: Permission; label: string }> = [
  { id: 'catalog:read', label: 'View product catalog' }, { id: 'catalog:write', label: 'Add and edit products' },
  { id: 'stock:read', label: 'View stock by location' }, { id: 'stock:receive', label: 'Receive stock' },
  { id: 'stock:sale', label: 'Record sale deductions' }, { id: 'activity:read', label: 'View movement history' },
  { id: 'users:manage', label: 'Create and deactivate user accounts' },
];

export default async function PermissionsPage() {
  const user = await requireUser();
  return <main className="page-shell">
    <div className="page-heading"><div><p className="eyebrow">ADMINISTRATION / ACCESS</p><h1>Roles and permissions</h1><p className="page-description">Compare the access levels available in this retail inventory demo.</p></div></div>
    <aside className="demo-notice"><span className="notice-mark" aria-hidden="true">i</span><p>You are signed in as <strong>{user.displayName}</strong> ({user.role}). Access is enforced by the server on every page and change request.</p></aside>
    <section className="catalog-panel permission-panel"><div className="table-scroll"><table className="product-table permission-table"><caption className="sr-only">Permissions by application role.</caption><thead><tr><th scope="col">Capability</th>{roles.map((role) => <th scope="col" key={role.id}>{role.label}</th>)}</tr></thead><tbody>{permissions.map((permission) => <tr key={permission.id}><th scope="row">{permission.label}</th>{roles.map((role) => <td key={role.id} aria-label={`${role.label}: ${hasPermission(role.id, permission.id) ? 'allowed' : 'not allowed'}`}>{hasPermission(role.id, permission.id) ? <span className="permission-yes">Allowed</span> : <span className="permission-no">Not allowed</span>}</td>)}</tr>)}</tbody></table></div></section>
    <p className="catalog-footnote">Project AI agents do not receive application accounts or act as human inventory users. This permission matrix applies to signed-in app users.</p>
  </main>;
}
