import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { listCategories } from '@/lib/db';
import { EditorMessage } from '../editor-message';
import { ProductForm } from '../product-form';

export default function NewProductPage() {
  return <main className="page-shell"><Suspense fallback={<p className="loading-panel">Preparing product form…</p>}><NewProductContent /></Suspense></main>;
}

async function NewProductContent() {
  if (process.env.NODE_ENV === 'production') {
    return <EditorMessage title="Local demo only" message="Product editing is disabled in production until sign-in and authorization are implemented." />;
  }

  await connection();
  let categories;
  try {
    categories = await listCategories();
  } catch (error) {
    console.error('Product form setup failed:', error instanceof Error ? error.name : 'unknown error');
    return <EditorMessage title="Product form unavailable" message="Check that the database migrations and local application role have been configured." />;
  }

  return (
    <>
      <nav className="breadcrumb" aria-label="Breadcrumb"><Link href="/products">Products</Link><span aria-hidden="true">/</span><span>Add product</span></nav>
      <div className="editor-heading"><p className="eyebrow">Catalog / New item</p><h1>Add a product</h1><p>Enter the details you use to identify and reorder this item.</p></div>
      <section className="editor-panel"><ProductForm product={null} categories={categories} /></section>
      <p className="catalog-footnote">Adding a product does not create stock. Once saved, record its initial quantity from the Stock page.</p>
    </>
  );
}
