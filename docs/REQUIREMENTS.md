# Retail inventory requirements

## Initial scope

Manage retail products using unique SKUs, names, categories, sale prices, reorder points, and stock by location. Record receiving, customer returns, manual sale deductions, and controlled physical-count adjustments with a reason, timestamp, and signed-in actor.

## First working milestone status

| Requirement | Implementation status | Runtime evidence |
| --- | --- | --- |
| Search products by name or SKU; add/edit/deactivate products. | Implemented in the local catalog UI and controlled database function. | Owner reported migrations 001–003 and app-role provisioning succeeded. |
| Receive stock and record a movement with actor attribution. | Implemented on `/stock`; requires permission and writes the verified session actor through `record_stock_movement`. | Migrations through 010 applied locally; rollback-only stock and auth smoke workflows passed. |
| Record sellable customer returns as positive stock movements. | Implemented on `/stock` using the receiving permission; the reason and verified actor enter the same append-only movement/audit path. | Expanded rollback-only database verification and clerk permission check passed locally; hosted CI rerun is pending. |
| Correct physical counts with positive or negative adjustments. | Implemented on `/stock`; only managers and administrators receive the `stock:adjust` capability, and the database still rejects a resulting negative balance. | Expanded rollback-only database verification and manager/clerk visibility checks passed locally; hosted CI rerun is pending. |
| Record a manual sale deduction and reject deductions above current on-hand. | Implemented on `/stock`; positive form quantity becomes a negative movement, and the database function rejects a negative resulting balance. | Rollback-only oversell checks passed locally; GitHub Actions run #10 passed the CI stock workflow and competing-deduction checks. |
| View balances and low-stock/reorder attention by location. | Implemented on `/stock` for active products at the selected location; attention appears when on-hand is at or below the product reorder point. | Verified with fictional demo records at Demo Outlet and Demo Store. |
| Search/filter movement activity. | Implemented on `/activity`, filtering by location, movement type, product name, SKU, or reason; newest-first, up to 200 rows. | Owner confirmed the local activity view and two-location sample history; GitHub Actions run #10 passed database migrations and integration checks. |

`npm run typecheck`, `npm run lint`, and `git diff --check` passed locally. The rollback-only `npm run db:verify-stock` check passed. GitHub Actions run #10 passed the production build, disposable-database concurrency test, and authentication/permission checks ([run details](https://github.com/sysinfo7/Inventory_System/actions/runs/38481389156)). Repository screenshots still need to be captured; a backup/restore rehearsal and production security review remain future work.

## Business and security boundaries

- The stock page offers receiving, sellable customer returns, count corrections, and **manual sale deductions**. It does not connect to a point-of-sale system, process payments, or create accounting entries.
- Activity is an inventory quantity history. New application writes record a verified signed-in user; sample seed movements retain NULL actor IDs.
- Roles Administrator, Manager, Clerk, and Read-only are enforced by server page/action checks. Codex project agents are not application accounts and cannot act as human inventory users.
- Local development is the only configured deployment. Use fictional demo records and do not expose it to untrusted users until rate limiting, account recovery, and production security controls are reviewed.
- Dashboard summary cards, supplier records, purchase orders, and POS integration remain out of current scope.

## Portfolio evidence

Demonstrate server-side input validation, SQL constraints, transactionally maintained balances, idempotent retries, oversell rejection, active-product enforcement, audit events, and automated checks. Report only evidence actually collected: the rollback-only verification script's presence is not evidence that its database assertions passed. Document human review of AI-generated changes without attributing decisions or checks without evidence.

## Pending decisions

Public GitHub repository: `sysinfo7/Inventory_System`. Pending: hosting, currency policy, and whether future sales workflows remain manual or integrate with a point-of-sale system. Sale price is stored as a decimal amount, but currency and financial valuation are undefined.
