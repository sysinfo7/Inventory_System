# Retail inventory requirements

## Initial scope

Manage retail products using unique SKUs, names, categories, sale prices, reorder points, and stock by location. Record receiving, customer returns, manual sale deductions, and controlled physical-count adjustments with a reason, timestamp, and signed-in actor.

## First working milestone status

| Requirement | Implementation status | Runtime evidence |
| --- | --- | --- |
| Search products by name or SKU; add/edit/deactivate products. | Implemented in the local catalog UI and controlled database function. | Owner reported migrations 001–003 and app-role provisioning succeeded. |
| Receive stock and record a movement with actor attribution. | Implemented on `/stock`; requires permission and writes the verified session actor through `record_stock_movement`. | Migrations through 015 applied locally; rollback-only stock and auth smoke workflows passed. |
| Record sellable customer returns as positive stock movements. | Implemented on `/stock` using the receiving permission; the reason and verified actor enter the same append-only movement/audit path. | Expanded rollback-only database verification and clerk permission check passed locally and in GitHub Actions for `v1.0.0`. |
| Correct physical counts with positive or negative adjustments. | Implemented on `/stock`; only managers and administrators receive the `stock:adjust` capability, and the database still rejects a resulting negative balance. | Expanded rollback-only database verification and manager/clerk visibility checks passed locally and in GitHub Actions for `v1.0.0`. |
| Record a manual sale deduction and reject deductions above current on-hand. | Implemented on `/stock`; positive form quantity becomes a negative movement, and the database function rejects a negative resulting balance. | Rollback-only oversell checks and CI competing-deduction checks passed for `v1.0.0`. |
| View balances and low-stock/reorder attention by location. | Implemented on `/stock` for active products at the selected location; attention appears when on-hand is at or below the product reorder point. | Verified with fictional demo records at Demo Outlet and Demo Store. |
| Search/filter movement activity. | Implemented on `/activity`, filtering by location, movement type, product name, SKU, reason, recorded-by actor, and inclusive UTC date range; newest-first, up to 200 rows. | Browser verified actor/date matches, legacy actor filter, and invalid date range feedback; GitHub Actions passed for `v1.3.1` on [main](https://github.com/sysinfo7/Inventory_System/actions/runs/38501795878) and [tag](https://github.com/sysinfo7/Inventory_System/actions/runs/38501795851). |
| Maintain retail suppliers and create, submit, receive, and cancel quantity-only purchase orders. | Implemented in application source and forward-only migrations 019–021. Manager/admin create and submit orders; admin manages supplier activation; clerk/manager/admin receive. Drafts do not affect stock; receipt quantities post atomically into movement history; partial cancellation preserves receipts. No costs, currency, invoices, or accounting entries. | Local migrations and rollback-only verifier passed; signed-in browser walkthrough completed a partial and final receipt. Purchasing CI awaits push. |

`npm run typecheck`, `npm run lint`, and `git diff --check` passed locally. The rollback-only stock, purchasing, and authentication checks passed locally. The current Windows production build attempt stopped in Turbopack while launching its CSS worker; earlier GitHub Actions production builds passed for prior releases. GitHub Actions passed the production build, disposable-database concurrency test, and authentication/permission checks for `v1.0.0` on [main](https://github.com/sysinfo7/Inventory_System/actions/runs/38491097632) and [the release tag](https://github.com/sysinfo7/Inventory_System/actions/runs/38491097851). Existing screenshots are included in the user manual; purchasing screenshots are still pending. A second off-checkout backup copy and production security review remain future work.

## Business and security boundaries

- The stock page offers receiving, sellable customer returns, count corrections, and **manual sale deductions**. It does not connect to a point-of-sale system or process payments.
- Purchasing adds suppliers and quantity-only purchase orders; it does not store supplier cost/currency, process invoices/payments/tax, or create financial-accounting entries.
- Activity is an inventory quantity history. New application writes record a verified signed-in user; sample seed movements retain NULL actor IDs.
- Roles Administrator, Manager, Clerk, and Read-only are enforced by server page/action checks. Codex project agents are not application accounts and cannot act as human inventory users.
- Existing sessions are revoked in PostgreSQL when a user's role changes or the account is deactivated; reactivation requires a new sign-in.
- Local development is the only configured deployment. Use fictional demo records and do not expose it to untrusted users until account recovery and production security controls are reviewed; the app-level login throttle is not a production edge control.
- Dashboard summary cards and POS integration remain out of current scope.

## Portfolio evidence

Demonstrate server-side input validation, SQL constraints, transactionally maintained balances, idempotent retries, oversell rejection, active-product enforcement, audit events, and automated checks. Report only evidence actually collected: the rollback-only verification script's presence is not evidence that its database assertions passed. Document human review of AI-generated changes without attributing decisions or checks without evidence.

## Pending decisions

Public GitHub repository: `sysinfo7/Inventory_System`. Pending: hosting, currency policy, and whether future sales workflows remain manual or integrate with a point-of-sale system. Sale price is stored as a decimal amount, but currency and financial valuation are undefined.
