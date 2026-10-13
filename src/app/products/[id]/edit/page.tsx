import Link from 'next/link';
import { connection } from 'next/server';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { findCatalogProduct, listCategories } from '@/lib/db';
import { EditorMessage } from '../../editor-message';
import { ProductForm } from '../../product-form';

export default function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  return <main className="page-shell"><Suspense fallback={<p className="loading-panel">Loading product…</p>}><EditProductContent params={params} /></Suspense></main>;
}

async function EditProductContent({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.NODE_ENV === 'production') {
    return <EditorMessage title="Local demo only" message="Product editing is disabled in production until sign-in and authorization are implemented." />;
  }

  await connection();
  const { id } = await params;
  let productData: Awaited<ReturnType<typeof findCatalogProduct>> = null;
  let categories: Awaited<ReturnType<typeof listCategories>> = [];
  try {
    [productData, categories] = await Promise.all([findCatalogProduct(id), listCategories()]);
  } catch (error) {
    console.error('Product edit load failed:', error instanceof Error ? error.name : 'unknown error');
    return <EditorMessage title="Product could not be loaded" message="Check the database connection and refresh the page." />;
  }

  if (!productData) notFound();
  return (
    <>
      <nav className="breadcrumb" aria-label="Breadcrumb"><Link href="/products">Products</Link><span aria-hidden="true">/</span><span>Edit product</span></nav>
      <div className="editor-heading"><p className="eyebrow">Catalog / {productData.sku}</p><h1>Edit product</h1><p>Changes are saved to the product audit trail. Past stock movements keep their recorded details.</p></div>
      <section className="editor-panel"><ProductForm product={productData} categories={categories} /></section>
    </>
  );
}
