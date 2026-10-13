import Link from 'next/link';

export function EditorMessage({ title, message }: { title: string; message: string }) {
  return (
    <section className="unavailable-panel">
      <p className="eyebrow">Inventory / Catalog</p>
      <h1>{title}</h1>
      <p>{message}</p>
      <Link className="button button-secondary" href="/products">Back to products</Link>
    </section>
  );
}
