# Supplier and purchase order UX specification

## Goal and scope

Let store staff maintain a small supplier directory, create and submit purchase orders for one destination location, receive all or part of an order, and inspect the resulting inventory history. Keep the feature focused on replenishment: no invoices, payments, tax, landed cost, vendor portal, approval chain, automatic reorder generation, or accounting ledger. The existing project has no configured currency, so do not show monetary totals or require unit cost in this milestone.

Use existing products, locations, roles, audit conventions, and stock movement behavior. A receipt increases on-hand stock only after the user confirms the received quantity. The receipt and purchase-order quantities/status must save atomically; a retry must not add stock twice. Preserve the existing freeform stock receipt workflow for stock arriving without a purchase order.

## Navigation and information architecture

Add **Suppliers** and **Purchase orders** as separate authenticated navigation entries. Keep page headings, search/filter toolbars, table semantics, status pills, empty states, button styles, and notices consistent with Products and Stock.

- **Suppliers** list: search by supplier name or contact, filter active/inactive, and open supplier details. Manager/Administrator can add or edit suppliers; only Administrator deactivates/reactivates them. Deactivation never deletes historical supplier or order records.
- **Purchase orders** list: search by order number or supplier; filter status, destination, and optional expected-delivery range. Default to newest first and show a compact summary of open orders.
- **Order details**: show order identity and status, supplier, destination, dates, notes, line quantities, received quantities, remaining quantities, and a dated receipt history. Make the next valid action visually prominent.

## Supplier screens

Keep the supplier form compact. Required: supplier name (maximum 160 characters). Optional: contact name (120), email (254), phone (40), and notes (500). Normalize whitespace; validate email only when supplied. Do not store payment, tax, bank, or credential data. Show active/inactive status and creation/update timestamps on detail. Block deactivation while creating a new order, but keep existing orders readable and receivable after supplier deactivation.

On the list, show Supplier, Contact, Email/phone, Status, and Actions. On narrow screens, render each supplier as a labeled card with the name/status first and contact details below. Empty state: “No suppliers yet” with a permission-aware Add supplier action and a brief explanation that supplier records are reused on orders.

## Purchase order creation and draft editing

Use a dedicated page rather than a dense modal, so long orders work on mobile and can be reviewed before submission. Group the form into **Order details** and **Products**.

Order details fields:

- Supplier: required searchable select of active suppliers; display name and contact hint. If none exist, offer a permission-aware link to add one.
- Deliver to: required location select; default to the current stock location if available, otherwise the first active location. Repeat destination on the detail header and receive form.
- Expected delivery date: optional date; must be today or later when entered.
- Notes: optional plain text, maximum 500 characters; no HTML.

Line editor fields: product searchable by name/SKU, ordered quantity as a positive whole number, and a remove-line action. Require at least one distinct product line; reject duplicate products and inactive products. Search results show both product name and SKU. After selection show product identity, quantity input, and remove button. Keep keyboard operation possible without drag-and-drop. On mobile, each line is a stacked labeled card with its product first. Do not silently discard lines when supplier or destination changes.

Actions: **Save draft** (primary), **Cancel** (returns to list with unsaved-change confirmation if dirty). Draft is editable; submitted orders are immutable except through receiving or cancellation. Display an order number after first save. Never present saving a draft as a stock change.

## Status and allowed actions

Use four statuses with clear labels and distinct text (color is supplementary): **Draft**, **Submitted**, **Partially received**, **Completed**, **Cancelled**.

- Draft: edit, submit, or cancel. Draft has no effect on on-hand quantity.
- Submitted: view, receive, or cancel. Once submitted, supplier, destination, and lines are locked to preserve the authorization and audit history.
- Partially received: view, receive remaining quantities, or cancel the unreceived remainder. Already received stock and receipt history remain unchanged after cancellation.
- Completed: read-only. Automatically set when all ordered quantities have been received; there is no separate “complete anyway” action that could hide an unreceived quantity.
- Cancelled: read-only. Preserve received quantities and receipts; canceled remainder never changes stock.

Submitting a draft requires a confirmation summary showing supplier, destination, line count, total units, and a statement that submission does not change on-hand stock. Cancellation requires a confirmation with the remaining units and explains that previously received stock stays in inventory. Do not permit an order with zero lines or zero quantities to submit.

## Receiving workflow

From a submitted or partially received order, provide **Receive items**. Show supplier, order number, destination, and each line's ordered, already received, remaining, and current location on-hand quantities. Each line has a received-now input defaulting to zero; accept whole numbers from zero through remaining quantity. Require at least one positive line before enabling confirmation. Provide an optional receipt reference (supplier packing slip, maximum 80 characters) and receipt note (maximum 300 characters).

Before save, summarize units being added by product and location. The final action reads **Record receipt**. On success, show a `role="status"` message with order number, total units received, destination, and whether the order remains open or is complete; refresh the order balances and receipt history. Link to filtered activity for that destination/order context when supported. Do not clear state on validation failure.

If an order has no remaining quantities, show “All quantities received” and no receive action. If the product is no longer active, explain which line cannot be received and offer no bypass; an authorized manager must resolve catalog status through the supported product workflow. A partial order cancellation must clearly distinguish “received” from “cancelled remaining.”

## Role affordances (proposed; enforce on server)

Keep authorization based on server-side role/permission checks; hiding buttons is only a usability layer. Add explicit permissions rather than overloading `stock:receive` or `catalog:write`:

| Role | Suppliers | Purchase orders | Receive against an order |
| --- | --- | --- | --- |
| Administrator | Create, edit, deactivate/reactivate | View, create/edit drafts, submit, cancel | Yes |
| Manager | Create/edit; no deactivation | View, create/edit drafts, submit, cancel | Yes |
| Clerk | Read active suppliers | View orders | Yes, only for submitted/partially received orders |
| Read-only | Read active suppliers | View orders | No |

Suggested permission names: `suppliers:read`, `suppliers:write`, `suppliers:manage`, `purchase_orders:read`, `purchase_orders:write`, and `purchase_orders:receive`. Manager cancellation and supplier deactivation should be independently decided before implementation; this first milestone uses the table above. Existing freeform receiving permissions remain unchanged.

For forbidden direct requests, return the app's normal access-denied experience and make no database change. Where an action is unavailable in the UI, do not leave a dead button; use plain “View only” or omit the action. Never imply AI agents can receive stock or act under an employee identity.

## Accessibility, responsive behavior, and feedback

- Every input has a persistent visible label; required fields are identified in text, not color alone. Use `aria-describedby` for help/errors and `aria-invalid` on invalid fields.
- On server validation failure, preserve submitted form values, show a concise error summary near the heading with links to invalid controls, and mark each relevant field. Focus the summary after submission where the framework permits.
- Announce save, submit, receive, and cancellation outcomes using `role="status"`; use `role="alert"` for blocking failures. Do not announce routine field hints repeatedly.
- Status pills include readable text. Tables have captions, scoped column headers, visible focus, and a sensible reading order. Mobile card layouts retain each field's label.
- All actions work with keyboard alone. Searchable selects expose their labels, results, empty result, and selection to assistive technology. Confirmation dialogs have an accessible title, initial focus, Escape behavior, and a clearly named cancel action; use a page-level confirmation if a compliant dialog is unavailable.
- At a narrow viewport, stack page headings/actions and form sections, keep primary actions full-width where practical, avoid horizontal page scrolling, and keep touch targets at least 44 CSS pixels. Tables may use the existing contained horizontal-scroll pattern only if card presentation is impractical.
- Include loading, unavailable, no-results, no-suppliers, no-locations, no-active-products, and permission-denied states. Never silently substitute a supplier, location, or product when a saved selection becomes inactive.

## Acceptance walkthrough

1. Manager creates a supplier, saves an order draft for a selected location with two distinct active products, then edits and saves it.
2. Submitting shows a review confirmation and does not change stock balances or create stock movements.
3. Clerk opens the submitted order, receives part of one line, and sees a partial status, remaining quantity, receipt history, attributed stock movements, and increased on-hand at the selected location only.
4. A repeated receipt request cannot duplicate inventory. Over-receipt, zero-only receipt, inactive product, and cross-location manipulation are rejected with useful feedback.
5. Clerk receives the remaining quantity; order becomes completed automatically and further receiving is unavailable.
6. A separate partially received order can be cancelled; prior receipts remain, the remaining amount is visibly canceled, and no stock is removed.
7. Unauthorized roles cannot perform the same mutations by posting directly. Read-only users can inspect order details but have no mutation actions.
8. Core create/edit/submit/receive/cancel paths and their validation, loading, empty, error, success, keyboard, and mobile states remain usable at desktop and narrow mobile widths.
