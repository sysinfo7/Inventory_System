import { connection } from 'next/server';
import { Suspense } from 'react';
import { hasPermission, requireReadPermission } from '@/lib/auth';
import { listSuppliers } from '@/lib/purchasing';
import { saveSupplierAction, setSupplierActiveAction } from '@/app/purchasing/actions';

type Props = { searchParams: Promise<{ q?: string; status?: string; saved?: string; error?: string }> };
const errorText: Record<string, string> = {
  invalid: 'Check the supplier name and optional contact details.', duplicate: 'A supplier with that name already exists.',
  failed: 'The supplier change could not be saved. No update was confirmed.',
};

export default function SuppliersPage(props: Props) {
  return <Suspense fallback={<main className="page-shell"><section className="loading-panel" aria-busy="true"><p>Loading suppliers…</p></section></main>}><SuppliersContent searchParams={props.searchParams} /></Suspense>;
}

async function SuppliersContent({ searchParams }: Props) {
  await connection();
  const user = await requireReadPermission('suppliers:read');
  const [params, allSuppliers] = await Promise.all([searchParams, listSuppliers(user.role === 'admin' || user.role === 'manager')]);
  const query = (params.q ?? '').trim().toLocaleLowerCase();
  const status = user.publicDemo ? 'active' : params.status === 'inactive' ? 'inactive' : params.status === 'all' ? 'all' : 'active';
  const suppliers = allSuppliers.filter((supplier) => (status === 'all' || (status === 'active' ? supplier.active : !supplier.active))
    && (!query || (user.publicDemo ? [supplier.name] : [supplier.name, supplier.contactName, supplier.email, supplier.phone]).some((field) => field?.toLocaleLowerCase().includes(query))));
  const canWrite = hasPermission(user.role, 'suppliers:write');
  const canManage = hasPermission(user.role, 'suppliers:manage');
  const canViewInactive = user.role === 'admin' || user.role === 'manager';
  return <main className="page-shell">
    <div className="page-heading"><div><p className="eyebrow">PURCHASING / DIRECTORY</p><h1>Suppliers</h1><p className="page-description">{user.publicDemo ? 'Browse the fictional supplier names used by this employer demo.' : 'Keep a small, reusable contact directory for retail replenishment orders.'}</p></div></div>
    {user.publicDemo && <aside className="demo-notice" aria-label="Public employer demo"><span className="notice-mark" aria-hidden="true">i</span><p><strong>Public read-only view.</strong> Supplier contact names, emails, phone numbers, and private notes are hidden.</p></aside>}
    {params.error && <p className="form-alert" role="alert">{errorText[params.error] ?? 'The supplier request could not be completed.'}</p>}
    {params.saved && <p className="success-notice" role="status">Supplier changes saved.</p>}
    {canWrite && <section className="editor-panel supplier-create-panel" aria-labelledby="supplier-add-title"><h2 id="supplier-add-title">Add supplier</h2><p className="field-hint">Do not enter payment, tax, or bank details here.</p>
      <form action={saveSupplierAction} className="supplier-form">
        <label className="form-field"><span>Supplier name <span aria-hidden="true">*</span></span><input name="name" maxLength={160} required /></label>
        <label className="form-field"><span>Contact name</span><input name="contactName" maxLength={120} /></label>
        <label className="form-field"><span>Email</span><input name="email" type="email" maxLength={254} /></label>
        <label className="form-field"><span>Phone</span><input name="phone" type="tel" maxLength={40} /></label>
        <label className="form-field supplier-notes"><span>Notes</span><textarea name="notes" maxLength={500} rows={2} /></label>
        <button className="button button-primary" type="submit">Save supplier</button>
      </form>
    </section>}
    <section className="catalog-panel supplier-list-panel" aria-labelledby="supplier-list-title"><div className="catalog-toolbar">
      <div><h2 id="supplier-list-title">Supplier directory</h2><p>{suppliers.length} {suppliers.length === 1 ? 'supplier' : 'suppliers'}</p></div>
      <form action="/suppliers" method="get" className="catalog-filters supplier-filters">
        <label className="sr-only" htmlFor="supplier-search">Search suppliers</label><input id="supplier-search" className="supplier-search" type="search" name="q" placeholder={user.publicDemo ? 'Search supplier name' : 'Search name or contact'} defaultValue={params.q ?? ''} />
        <label className="sr-only" htmlFor="supplier-status">Supplier status</label><select id="supplier-status" name="status" defaultValue={status}><option value="active">Active</option>{canViewInactive && <><option value="inactive">Inactive</option><option value="all">All</option></>}</select>
        <button className="button button-secondary" type="submit">Filter</button>
      </form>
    </div>
      {suppliers.length === 0 ? <div className="empty-state"><h3>{allSuppliers.length ? 'No suppliers match this filter' : 'No suppliers yet'}</h3><p>{allSuppliers.length ? 'Try another name, contact, or status.' : 'Supplier records are reused on purchase orders.'}</p></div>
        : <div className="table-scroll"><table className="product-table supplier-table"><caption className="sr-only">{user.publicDemo ? 'Fictional supplier names and status.' : 'Supplier contact list and status.'}</caption><thead><tr><th scope="col">Supplier</th>{!user.publicDemo && <><th scope="col">Contact</th><th scope="col">Email / phone</th></>}<th scope="col">Status</th>{!user.publicDemo && <th scope="col">Actions</th>}</tr></thead><tbody>
          {suppliers.map((supplier) => <tr key={supplier.id}>
            <td data-label="Supplier"><strong>{supplier.name}</strong>{!user.publicDemo && <><small className="supplier-date">Created {new Date(supplier.createdAt).toLocaleDateString()} · updated {new Date(supplier.updatedAt).toLocaleDateString()}</small>{supplier.notes && <p className="supplier-row-note">{supplier.notes}</p>}</>}</td>
            {!user.publicDemo && <><td data-label="Contact">{supplier.contactName || <span className="muted">Not provided</span>}</td>
            <td data-label="Email / phone"><span>{supplier.email ?? '—'}</span>{supplier.phone && <small>{supplier.phone}</small>}</td></>}
            <td data-label="Status"><span className={`status-pill ${supplier.active ? 'status-active' : 'status-inactive'}`}>{supplier.active ? 'Active' : 'Inactive'}</span></td>
            {!user.publicDemo && <td data-label="Actions"><div className="supplier-actions">
              {canWrite && <details className="supplier-edit-details"><summary className="table-action">Edit</summary><form action={saveSupplierAction} className="supplier-edit-form">
                <input type="hidden" name="supplierId" value={supplier.id} />
                <label className="form-field"><span>Supplier name</span><input name="name" maxLength={160} defaultValue={supplier.name} required /></label>
                <label className="form-field"><span>Contact name</span><input name="contactName" maxLength={120} defaultValue={supplier.contactName ?? ''} /></label>
                <label className="form-field"><span>Email</span><input name="email" type="email" maxLength={254} defaultValue={supplier.email ?? ''} /></label>
                <label className="form-field"><span>Phone</span><input name="phone" type="tel" maxLength={40} defaultValue={supplier.phone ?? ''} /></label>
                <label className="form-field"><span>Notes</span><textarea name="notes" maxLength={500} rows={2} defaultValue={supplier.notes ?? ''} /></label>
                <button className="button button-secondary" type="submit">Save edits</button>
              </form></details>}
              {canManage && <form action={setSupplierActiveAction}><input type="hidden" name="supplierId" value={supplier.id} /><input type="hidden" name="active" value={supplier.active ? 'false' : 'true'} /><button className="table-action" type="submit">{supplier.active ? 'Deactivate' : 'Reactivate'}</button></form>}
              {!canWrite && <span className="muted">View only</span>}
            </div></td>}
          </tr>)}
        </tbody></table></div>}
    </section>
    {user.publicDemo && <p className="catalog-footnote">This demo uses fictional supplier records. No contact or payment details should be entered into a public demo database.</p>}
    {!user.publicDemo && (user.role === 'clerk' || user.role === 'viewer') ? <p className="catalog-footnote">Inactive suppliers and supplier-management controls are limited to managers and administrators.</p> : null}
  </main>;
}
