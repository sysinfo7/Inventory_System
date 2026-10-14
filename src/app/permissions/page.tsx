import { connection } from 'next/server';
import { Suspense } from 'react';
import { requireUser, type Permission, type Role, hasPermission } from '@/lib/auth';

const roles: Array<{ id: Role; label: string; description: string }> = [
  { id: 'admin', label: 'Administrator', description: 'Full inventory access, purchasing, supplier administration, and user administration.' },
  { id: 'manager', label: 'Manager', description: 'Manage products, purchasing, stock, count adjustments, and activity.' },
  { id: 'clerk', label: 'Clerk', description: 'View inventory and purchase orders; record receipts, returns, and sales deductions.' },
  { id: 'viewer', label: 'Read-only', description: 'Review products, stock, suppliers, purchase orders, and activity.' },
];
const permissions: Array<{ id: Permission; label: string }> = [
  { id: 'catalog:read', label: 'View product catalog' }, { id: 'catalog:write', label: 'Add and edit products' },
  { id: 'stock:read', label: 'View stock by location' }, { id: 'stock:receive', label: 'Receive stock and customer returns' },
  { id: 'stock:sale', label: 'Record sale deductions' }, { id: 'activity:read', label: 'View movement history' },
  { id: 'stock:adjust', label: 'Record inventory adjustments' },
  { id: 'users:manage', label: 'Create and deactivate user accounts' },
  { id: 'suppliers:read', label: 'View suppliers' }, { id: 'suppliers:write', label: 'Create and edit suppliers' },
  { id: 'suppliers:manage', label: 'Deactivate or reactivate suppliers' },
  { id: 'purchase_orders:read', label: 'View purchase orders' }, { id: 'purchase_orders:write', label: 'Create, submit, and cancel purchase orders' },
  { id: 'purchase_orders:receive', label: 'Receive purchase-order items' },
];

export default function PermissionsPage() {
  return <Suspense fallback={<main className="page-shell"><section className="loading-panel" aria-busy="true"><p>Loading permissions…</p></section></main>}><PermissionsContent /></Suspense>;
}

async function PermissionsContent() {
  await connection();
  const user = await requireUser();
  return <main className="page-shell">
    <div className="page-heading"><div><p className="eyebrow">ADMINISTRATION / ACCESS</p><h1>Roles and permissions</h1><p className="page-description">Compare the access levels available in this retail inventory demo.</p></div></div>
    <aside className="demo-notice"><span className="notice-mark" aria-hidden="true">i</span><p>You are signed in as <strong>{user.displayName}</strong> ({user.role}). Access is enforced by the server on every page and change request.</p></aside>
    <section className="catalog-panel permission-panel"><div className="table-scroll"><table className="product-table permission-table"><caption className="sr-only">Permissions by application role.</caption><thead><tr><th scope="col">Capability</th>{roles.map((role) => <th scope="col" key={role.id}>{role.label}</th>)}</tr></thead><tbody>{permissions.map((permission) => <tr key={permission.id}><th scope="row">{permission.label}</th>{roles.map((role) => <td key={role.id} aria-label={`${role.label}: ${hasPermission(role.id, permission.id) ? 'allowed' : 'not allowed'}`}>{hasPermission(role.id, permission.id) ? <span className="permission-yes">Allowed</span> : <span className="permission-no">Not allowed</span>}</td>)}</tr>)}</tbody></table></div></section>
    <p className="catalog-footnote">Project AI agents do not receive application accounts or act as human inventory users. This permission matrix applies to signed-in app users.</p>
  </main>;
}
