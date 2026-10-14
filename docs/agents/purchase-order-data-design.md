# Supplier and purchase-order data design proposal

**Status:** Implemented in migrations 019–021, application purchasing pages/actions, and a rollback-only verifier. Local runtime and signed-in browser verification passed; CI awaits push.
**Baseline inspected:** PostgreSQL migrations `001`–`018`, current stock/auth code, `AGENTS.md`, `docs/agents/TEAM.md`, and `docs/REQUIREMENTS.md`.

## Intended workflow

1. A manager or administrator creates/updates an active supplier and creates a draft order for one supplier and destination location. Draft lines reference active products and positive whole-unit quantities. The feature has no currency policy, so it stores no supplier costs.
2. The manager/admin submits the order. Submission snapshots supplier, destination, product labels, and ordered quantities. Managers/admins can cancel a draft, submitted, or partially received order with a required reason; already received units remain in history and only the remainder is closed.
3. A clerk, manager, or administrator records one receipt against an open/partially received order. A receipt may include a subset of lines and less than the remaining quantity on each line. A user may split a delivery across multiple receipt submissions.
4. One database transaction inserts a receipt and its receipt lines, calls the existing `record_stock_movement` once for each receipt line using positive deltas and type `receiving`, and updates the order lifecycle to `partially_received` or `received`. Any validation or stock-write failure rolls back the receipt, every movement, and the status change together.
5. Receipt records and stock movements are append-only. Mistakes are corrected with a compensating inventory movement and, if necessary, a separately audited order exception; historical receipt quantities are never edited or deleted.

## Normalized relational model

- `suppliers`: internal ID, unique normalized name, active flag, created/updated timestamps. Add contact fields only when a real workflow needs them; avoid collecting unnecessary personal data.
- `purchase_orders`: internal ID, unique human-readable order number, supplier FK, destination `locations` FK, lifecycle status (`draft`, `submitted`, `partially_received`, `received`, `cancelled`), creator FK, timestamps, optional bounded notes. One supplier and one destination per order.
- `purchase_order_lines`: ID, purchase-order FK, product FK, positive ordered quantity, and immutable submitted SKU/product-name snapshots. No quoted unit cost is stored. Unique `(purchase_order_id, product_id)` avoids duplicate product lines; receipt functions reject duplicate line IDs in one payload.
- `purchase_receipts`: ID, order FK, unique client request UUID, receiving actor FK, received timestamp, optional reference/note. One successful submission is one receipt.
- `purchase_receipt_lines`: ID, receipt FK, order-line FK, positive received quantity, and unique `stock_movement_id` FK. Unique `(receipt_id, purchase_order_line_id)` permits at most one row per order line per receipt. Receipt quantity is the canonical record of progress; outstanding quantity is `ordered_quantity - SUM(receipt_line.quantity)` and is never maintained as a second writable counter.
- `purchasing_audit_log`: append-only events for supplier and order lifecycle/line changes, actor, request ID, entity identity, timestamp, and appropriately minimized before/after JSON. Receipt creation can be audited there, while the existing `inventory_audit_log` independently captures each resulting stock movement. Do not present either as a complete financial ledger.

Enforce same-order consistency with composite keys where practical: `purchase_order_lines` has `UNIQUE (purchase_order_id, id)`; `purchase_receipts` has `UNIQUE (id, purchase_order_id)`; each receipt line carries `purchase_order_id` and has composite foreign keys to both its receipt `(receipt_id, purchase_order_id)` and its line `(purchase_order_id, purchase_order_line_id)`. This prevents attaching an order line from a different order even if a caller bypasses UI validation. A unique FK on `stock_movement_id` prevents one movement from representing multiple receipt lines. The controlled function additionally verifies the movement's product, location, positive delta, receiving type, and actor match the receipt line/header.

## Atomic receive and retry contract

Implement receipt posting as one restricted `SECURITY DEFINER` PostgreSQL function, called by a server action only after authentication and `purchase_orders:receive` authorization. Keep a DB transaction around all steps (the function call itself runs within the caller statement transaction):

1. Validate a version-4 request UUID, active actor, bounded nonempty line list, unique line IDs, positive integer quantities, valid reason/reference lengths, and the requested order ID.
2. Take a transaction advisory lock in a receipt-specific namespace for the request UUID; look up an existing receipt with that UUID. If found, compare the normalized requested `(order_line_id, quantity)` set with its persisted receipt lines. Return its existing receipt/movement IDs only on an exact match; otherwise raise an idempotency-key conflict. This covers a lost HTTP response after commit. Also keep a database unique constraint on `purchase_receipts.request_id` as the final race guard.
3. Lock the order row `FOR UPDATE`, then verify it is submitted or partially received and is not cancelled/complete. Lock requested order-line rows in ascending ID order. All order edit, submit, cancel, and receive functions must take the same parent order lock first, so state changes cannot race with receiving.
4. For every input line, calculate already received as `SUM(purchase_receipt_lines.quantity)` and reject if requested quantity exceeds the remaining quantity. Check products remain active; the stock function also rechecks active status under its own product lock. Do not rely on a browser-displayed remaining amount.
5. Insert the receipt header and lines; for each line call `record_stock_movement(product_id, destination_id, quantity, 'receiving', bounded_reason, verified_actor_id, generated_unique_movement_request_uuid, NULL)`. Save returned movement ID to that receipt line. The receipt request UUID and movement request UUIDs have distinct purposes. A rollback undoes all related writes if any line fails.
6. Recompute received quantities and update lifecycle status under the still-held order lock. Return the receipt ID and movement IDs. Revalidate the stock/activity/order pages after commit.

Do not create the receipt first in a separately committed transaction, call the stock function from a later request, or reuse the same movement request ID across different receipt lines. Do not blindly re-run the whole payload after a partial external success: atomicity means the database has either all receipt effects or none. Existing `record_stock_movement` provides a second idempotency barrier for each movement, including its unique partial index and request-key advisory lock.

## Authorization and least privilege

Proposed application capabilities:

| Capability | Viewer | Clerk | Manager | Admin |
| --- | --- | --- | --- | --- |
| `suppliers:read`, `purchase_orders:read` | yes | yes | yes | yes |
| `suppliers:write`, `purchase_orders:write` (supplier edit, draft/edit, submit/cancel) | no | no | yes | yes |
| `suppliers:manage` (deactivate/reactivate supplier) | no | no | no | yes |
| `purchase_orders:receive` (post partial/final receipts) | no | yes | yes | yes |

Enforce capabilities in every page, server action, and route; hiding controls is not authorization. The server derives actor identity from the verified session. Optionally repeat active-user/role checks inside the privileged DB functions as defense in depth. Current architecture does not give each human a separate PostgreSQL principal: the database trusts the actor UUID supplied by the server using `APP_DATABASE_URL`, as existing `save_product` and stock-write paths do. Document this trust boundary; do not claim PostgreSQL independently authenticates application actors.

The runtime `inventory_app` role receives `SELECT` only on the new read tables and `EXECUTE` on narrowly scoped supplier/order/receive functions. Direct `INSERT`, `UPDATE`, `DELETE`, and `TRUNCATE` are revoked from `PUBLIC` and `inventory_app`. The existing `inventory_function_owner` receives only the table/sequence rights required by those functions and audit triggers, plus execute access to `record_stock_movement`; functions are `SECURITY DEFINER`, with fixed safe `search_path`, owned by `inventory_function_owner`, and not executable by `PUBLIC`. Receipts, receipt lines, movements, and audits reject mutation/truncation. Draft order editing is behind an audited function; submitted lines and received facts remain immutable.

## Migration sequencing and verification plan

The baseline ended at `018`; migrations `019_purchasing_tables.sql` and `020_purchasing_functions.sql` now hold the forward-only schema and routine/grant changes. The normal migration runner sorts numbered SQL files, records checksums, and rejects edits to applied migrations. `docs/EMPLOYER_DATABASE_DESIGN.md` has been updated with the current ERD, field/key descriptions, migration sequence, trigger/security notes, and implementation-vs-verification status.

Focused disposable-database tests should cover: supplier/name uniqueness; draft validation and immutable submitted lines; zero/negative/oversized quantities; unknown/inactive products; wrong-order line IDs; partial then final receipts; exact retry returning the same receipt/movement IDs; same request key with changed line payload rejected; over-receipt under two concurrent transactions; duplicate line IDs; concurrent cancel/edit versus receive; failure on the second line rolling back the first stock movement; stock/activity actor and reason attribution; no direct runtime table writes; permission denial by role; append-only guards. Existing `db:verify-stock` and concurrency checks provide patterns, but add a dedicated purchasing verifier and CI step before release.

## Settled decisions and remaining verification

- No currency was configured. This implementation stores no supplier costs, invoices, payments, taxes, or accounting entries; add financial purchasing only after a currency and accounting policy are decided.
- Partially received cancellation is allowed for manager/admin with a required reason. Existing receipts stay immutable; only remaining units are canceled. Completed orders are terminal.
- Historical orders remain readable after supplier deactivation. New orders and draft submission require an active supplier. Inactive products cannot be received.
- Supplier names are unique after whitespace normalization and case folding; deactivation is soft.
- `purchasing:verify` runs its fixture inside one transaction and rolls it back. It checks sequential role and receipt behavior but does not yet prove two-session purchasing races, UI rendering, or visual responsive behavior. Local Docker and browser checks and CI must complete before the version is released.
- This schema creates inventory movement/audit evidence, not accounting-grade purchasing or payment records. Retention and production deployment still need separate review.
