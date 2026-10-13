# Retail inventory requirements

## Initial scope

Manage retail products using unique SKUs, names, categories, sale prices, reorder points, and stock by location. Record receiving and sale deductions with a reason and timestamp. The broader schema supports return and adjustment movement types, but these currently have no UI workflow.

## First working milestone status

| Requirement | Implementation status | Runtime evidence |
| --- | --- | --- |
| Search products by name or SKU; add/edit/deactivate products. | Implemented in the local catalog UI and controlled database function. | Owner reported migrations 001–003 and app-role provisioning succeeded. |
| Receive stock and record a movement. | Implemented on `/stock`; database action writes through `record_stock_movement`. | Migrations 004/005 are pending owner application; workflow verification script has not been run against the owner's database. |
| Record a manual sale deduction and reject deductions above current on-hand. | Implemented on `/stock`; positive form quantity becomes a negative movement, and the database function rejects a negative resulting balance. | Code checks passed locally; database integration/oversell runtime evidence is pending. |
| View balances and low-stock/reorder attention by location. | Implemented on `/stock` for active products at the selected location; attention appears when on-hand is at or below the product reorder point. | Requires owner application of migrations 004/005 and live local review. |
| Search/filter movement activity. | Implemented on `/activity`, filtering by location, movement type, product name, SKU, or reason; newest-first, up to 200 rows. | Requires owner application of migrations and live local review. |

Atlas reports `npm run typecheck`, `npm run lint`, verification-script syntax checks, and `git diff --check` passed for the current work. No production build, stock database integration run, runtime concurrency check, or screenshots are confirmed. `npm run db:verify-stock` is implemented as a rollback-only database workflow check; it has not been executed against the owner's database.

## Business and security boundaries

- The stock page offers receiving and **manual sale deductions**. It does not connect to a point-of-sale system, process payments, or create accounting entries.
- Activity is an inventory quantity history. Actor UUIDs are passed as `NULL` by the current actions because authentication is absent; no human identity is verified.
- Stock reads and actions are restricted to local development while authentication is absent. Use fictional demo records and do not expose the app to untrusted users.
- Returns and adjustments remain planned UI workflows despite their supported database movement types. Dashboard summary cards, supplier records, purchase orders, and POS integration are also out of current scope.

## Portfolio evidence

Demonstrate server-side input validation, SQL constraints, transactionally maintained balances, idempotent retries, oversell rejection, active-product enforcement, audit events, and automated checks. Report only evidence actually collected: the rollback-only verification script's presence is not evidence that its database assertions passed. Document human review of AI-generated changes without attributing decisions or checks without evidence.

## Pending decisions

Public GitHub repository: `sysinfo7/Inventory_System`. Pending: hosting, authentication roles, currency policy, and whether future sales workflows remain manual or integrate with a point-of-sale system. Sale price is stored as a decimal amount, but currency and financial valuation are undefined.
