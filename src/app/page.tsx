export default function Home() {
  return <main className="mx-auto max-w-4xl px-8 py-20">
    <p className="text-sm font-semibold uppercase tracking-widest text-blue-600">Inventory system / Project foundation</p>
    <h1 className="mt-5 text-5xl font-bold tracking-tight">Know what you have.<br />Track what changes.</h1>
    <p className="mt-6 text-lg text-gray-500">An inventory portfolio project using TypeScript, Next.js, and PostgreSQL. Development setup is in place; inventory workflows are the next milestone.</p>
    <div className="mt-12 grid gap-6 sm:grid-cols-3">
      {[["Product catalog", "Planned: products, unique SKUs, and reorder points."], ["Stock movements", "Planned: receive and issue stock with a traceable history."], ["Inventory insights", "Planned: location balances and low-stock alerts."]].map(([title, description]) => <section key={title} className="rounded-xl border border-gray-200 p-6"><h2 className="text-xl font-semibold">{title}</h2><p className="mt-3 text-sm text-gray-500">{description}</p></section>)}
    </div>
  </main>;
}
