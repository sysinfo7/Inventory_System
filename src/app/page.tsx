import Link from 'next/link';
import { currentUser, hasPermission } from '@/lib/auth';

const milestones = [
  { number: '01', title: 'Product catalog', description: 'Organize product identity, categories, prices, and reorder points.', status: 'Ready to explore', href: '/products', icon: '▤', ready: true },
  { number: '02', title: 'Stock by location', description: 'View current on-hand quantities and low-stock attention for each location.', status: 'Ready to explore', href: '/stock', icon: '◫', ready: true },
  { number: '03', title: 'Movement activity', description: 'Record receiving and manual sale deductions with a signed history.', status: 'Ready to explore', href: '/activity', icon: '↗', ready: true },
];

export default async function Home() {
  const user = await currentUser();
  return (
    <main className="home-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow"><span className="live-dot" aria-hidden="true" /> RETAIL INVENTORY / PROJECT FOUNDATION</p>
          <h1>Know what you have.<br /><span>Track what changes.</span></h1>
          <p className="hero-description">A carefully structured inventory system, built around clear product records and a dependable history of every stock change.</p>
          <div className="hero-actions">
            {!user && <Link href="/login" className="button button-primary">Sign in to inventory <span aria-hidden="true">→</span></Link>}
            {user && hasPermission(user.role, 'catalog:read') && <Link href="/products" className="button button-primary">Explore product catalog <span aria-hidden="true">→</span></Link>}
            {user && hasPermission(user.role, 'catalog:write') && <Link href="/products/new" className="text-link">Add a product <span aria-hidden="true">↗</span></Link>}
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
          <div className="art-card art-card-back"><span className="art-line" /><span className="art-line short" /><span className="art-line" /></div>
          <div className="art-card art-card-front"><span className="art-product-icon">▤</span><span className="art-label">CATALOG</span><span className="art-number">01</span></div>
          <span className="art-spark spark-one">✳</span><span className="art-spark spark-two">✳</span>
        </div>
      </section>

      <section className="milestone-section" aria-labelledby="milestone-title">
        <div className="section-heading">
          <div><p className="eyebrow">THE BUILD</p><h2 id="milestone-title">A foundation for better stock decisions.</h2></div>
          <p>Each step builds on a reliable product and movement record.</p>
        </div>
        <div className="milestone-grid" id="planned">
          {milestones.map((item) => (
            <article className={`milestone-card ${item.ready ? 'milestone-ready' : ''}`} key={item.number}>
              <div className="milestone-top"><span className="milestone-number">{item.number}</span><span className="milestone-icon" aria-hidden="true">{item.icon}</span></div>
              <span className={`milestone-status ${item.ready ? 'ready-status' : ''}`}><span aria-hidden="true">●</span> {item.status}</span>
              <h3>{item.title}</h3><p>{item.description}</p>
              {item.ready ? <Link href={item.href} className="milestone-link">Open {item.title.toLowerCase()} <span aria-hidden="true">→</span></Link>
                : <span className="milestone-link planned-link">On the roadmap</span>}
            </article>
          ))}
        </div>
      </section>

      <section className="principles-row" aria-label="Project principles">
        <div><span className="principle-icon" aria-hidden="true">⌘</span><span><strong>Structured data</strong><small>Normalized PostgreSQL design</small></span></div>
        <div><span className="principle-icon" aria-hidden="true">↺</span><span><strong>Traceable changes</strong><small>Product edits join an audit trail</small></span></div>
        <div><span className="principle-icon" aria-hidden="true">◇</span><span><strong>Built with care</strong><small>Secure patterns and clear limits</small></span></div>
      </section>
      <p className="home-disclaimer">{user ? `Signed in as ${user.displayName} · Role: ${user.role}` : 'Sign in with your inventory account to explore the local portfolio demo.'}</p>
    </main>
  );
}
