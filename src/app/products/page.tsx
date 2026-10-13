import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { listCatalogProducts } from '@/lib/db';

type QueryValue = string | string[] | undefined;
type ProductsPageProps = { searchParams: Promise<{ q?: QueryValue; status?: QueryValue; saved?: QueryValue }> };

function firstValue(value: QueryValue) {
  return Array.isArray(value) ? value[0] : value;
}

export default function ProductsPage(props: ProductsPageProps) {
  return (
    <main className="page-shell">
      <Suspense fallback={<CatalogLoading />}>
        <CatalogContent searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}

async function CatalogContent({ searchParams }: ProductsPageProps) {
  // Keep the database-backed catalog out of production until real authentication exists.
  if (process.env.NODE_ENV === 'production') {
    return <CatalogUnavailable message="The catalog demo is limited to local development until sign-in is implemented." />;
  }

  await connection();
  const params = await searchParams;
  const rawSearch = firstValue(params.q);
  const search = typeof rawSearch === 'string' ? rawSearch.trim().slice(0, 100) : '';
  const rawStatus = firstValue(params.status);
  const status = rawStatus === 'inactive' || rawStatus === 'all' ? rawStatus : 'active';

  let products;
  try {
    products = await listCatalogProducts(search, status);
  } catch (error) {
    console.error('Catalog load failed:', error instanceof Error ? error.name : 'unknown error');
    return <CatalogUnavailable message="The product list could not be loaded. Check the database setup steps, then refresh." />;
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Inventory / Catalog</p>
          <h1>Products</h1>
          <p className="page-description">Keep product details organized. Stock changes are recorded separately in the movement history.</p>
        </div>
        <Link className="button button-primary" href="/products/new">Add product <span aria-hidden="true">+</span></Link>
      </div>

      <aside className="demo-notice" aria-label="Local demo notice">
        <span className="notice-mark" aria-hidden="true">i</span>
        <p><strong>Local demo mode.</strong> Authentication is not implemented. Use this app only on your own development computer and enter fictional data.</p>
      </aside>

      {firstValue(params.saved) === '1' && <p className="success-notice" role="status">Product saved. The catalog has been refreshed.</p>}

      <section className="catalog-panel" aria-labelledby="catalog-list-heading">
        <div className="catalog-toolbar">
          <div>
            <h2 id="catalog-list-heading">Product catalog</h2>
            <p>{products.length === 100 ? 'Showing the first 100 matching products' : `${products.length} ${products.length === 1 ? 'product' : 'products'} shown`}</p>
          </div>
          <form action="/products" method="get" className="catalog-filters">
            <label className="search-field">
              <span className="sr-only">Search by product name or SKU</span>
              <span aria-hidden="true">⌕</span>
              <input type="search" name="q" placeholder="Search name or SKU" defaultValue={search} maxLength={100} />
            </label>
            <label className="sr-only" htmlFor="catalog-status">Filter by status</label>
            <select id="catalog-status" name="status" defaultValue={status}>
              <option value="active">Active products</option>
              <option value="inactive">Inactive products</option>
              <option value="all">All statuses</option>
            </select>
            <button type="submit" className="button button-secondary">Search</button>
          </form>
        </div>

        {products.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon" aria-hidden="true">▤</div>
            <h3>{search ? 'No matching products' : status === 'active' ? 'No active products yet' : 'No products found'}</h3>
            <p>{search ? `No products matched “${search}”. Try another name or SKU.` : 'Add a product to begin building the catalog.'}</p>
            {search ? <Link href="/products" className="button button-secondary">Clear search</Link>
              : <Link href="/products/new" className="button button-primary">Add your first product</Link>}
          </div>
        ) : (
          <div className="table-scroll">
            <table className="product-table">
              <caption className="sr-only">Products matching the selected status and search.</caption>
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">SKU</th>
                  <th scope="col">Category</th>
                  <th scope="col">Sale price</th>
                  <th scope="col">Reorder point</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id}>
                    <td data-label="Product"><span className="product-name">{product.name}</span><span className="product-subtitle">Retail item</span></td>
                    <td data-label="SKU"><code className="sku-tag">{product.sku}</code></td>
                    <td data-label="Category">{product.categoryName ?? <span className="muted">Uncategorized</span>}</td>
                    <td data-label="Sale price">{product.salePrice ?? <span className="muted">—</span>}</td>
                    <td data-label="Reorder point">{product.reorderPoint} <span className="muted">units</span></td>
                    <td data-label="Status"><span className={`status-pill ${product.active ? 'status-active' : 'status-inactive'}`}><span aria-hidden="true">●</span> {product.active ? 'Active' : 'Inactive'}</span></td>
                    <td data-label="Actions"><Link className="table-action" href={`/products/${product.id}/edit`}>Edit <span className="sr-only">{product.name}</span></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="catalog-footnote">Prices are stored as decimal amounts; no currency has been configured. Product edits are audited. This screen does not change stock on hand.</p>
    </>
  );
}

function CatalogLoading() {
  return <section className="loading-panel" aria-busy="true"><p className="eyebrow">Inventory / Catalog</p><h1>Products</h1><p>Loading product catalog…</p></section>;
}

function CatalogUnavailable({ message }: { message: string }) {
  return (
    <section className="unavailable-panel">
      <p className="eyebrow">Inventory / Catalog</p>
      <h1>Catalog unavailable</h1>
      <p>{message}</p>
      <Link className="button button-secondary" href="/">Back to overview</Link>
    </section>
  );
}
