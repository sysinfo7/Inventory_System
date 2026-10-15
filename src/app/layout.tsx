import type { Metadata } from "next";
import Link from "next/link";
import { currentUser, isPublicDemoModeEnabled } from "@/lib/auth";
import { LogoutButton } from "@/app/logout/logout-button";
import "./globals.css";
import { Suspense } from "react";
export const metadata: Metadata = { title: "Inventory System | Retail inventory", description: "Local retail inventory catalog, stock tracking, and movement history" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body className="min-h-screen antialiased">
    <div className="app-frame">
      <header className="topbar">
        <Link href="/" className="brand" aria-label="Inventory System overview">
          <span className="brand-mark" aria-hidden="true">I</span>
          <span className="brand-copy"><strong>Inventory</strong><small>RETAIL OPERATIONS</small></span>
        </Link>
        <Suspense fallback={<span className="environment-tag">Loading session…</span>}><SessionNavigation /></Suspense>
      </header>
      <Suspense fallback={<main className="page-shell"><section className="loading-panel" aria-busy="true"><p>Loading inventory…</p></section></main>}>{children}</Suspense>
    </div>
  </body></html>;
}

async function SessionNavigation() {
  const user = await currentUser();
  const publicDemo = !user && isPublicDemoModeEnabled();
  return <>
    <nav className="top-nav" aria-label="Main navigation">
      <Link href="/">Overview</Link>
      {publicDemo && <><Link href="/products">Products</Link><Link href="/stock">Stock</Link><Link href="/purchase-orders">Purchase orders</Link><Link href="/suppliers">Suppliers</Link><Link href="/activity">Activity</Link></>}
      {user && (user.passwordChangeRequired
        ? <Link href="/account/security?required=1">Change password</Link>
        : <><Link href="/products">Products</Link><Link href="/stock">Stock</Link><Link href="/purchase-orders">Purchase orders</Link><Link href="/suppliers">Suppliers</Link><Link href="/activity">Activity</Link><Link href="/permissions">Permissions</Link><Link href="/account/security">Account</Link>{user.role === 'admin' && <Link href="/users">Users</Link>}</>)}
    </nav>
    {user ? <div className="account-controls"><span className="environment-tag"><span aria-hidden="true">●</span> {user.displayName} · {user.role}</span><LogoutButton /></div>
      : publicDemo ? <span className="environment-tag public-demo-tag">Employer demo · read only</span>
      : <Link className="button button-secondary sign-in-link" href="/login">Sign in</Link>}
  </>;
}
