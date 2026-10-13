import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
export const metadata: Metadata = { title: "Inventory System | Retail inventory", description: "Local retail inventory catalog, stock tracking, and movement history" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body className="min-h-screen antialiased">
    <div className="app-frame">
      <header className="topbar">
        <Link href="/" className="brand" aria-label="Inventory System overview">
          <span className="brand-mark" aria-hidden="true">I</span>
          <span className="brand-copy"><strong>Inventory</strong><small>RETAIL OPERATIONS</small></span>
        </Link>
        <nav className="top-nav" aria-label="Main navigation">
          <Link href="/">Overview</Link>
          <Link href="/products">Products</Link>
          <Link href="/stock">Stock</Link>
          <Link href="/activity">Activity</Link>
        </nav>
        <span className="environment-tag"><span aria-hidden="true">●</span> Local demo</span>
      </header>
      {children}
    </div>
  </body></html>;
}
