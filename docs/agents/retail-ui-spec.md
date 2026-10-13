# Retail inventory UI/UX specification

Status: design and review reference. The product catalog is implemented for local development; other workflows remain proposed and are not represented as working screens. Business and authorization assumptions needing approval are called out below.

## Product principles

- Put the next useful task first: find a SKU, understand stock by location, receive stock, or record an issue.
- Keep on-hand quantity distinct from sales value, purchase cost, and financial accounting. The inventory ledger records unit quantity changes, not currency postings.
- Show which location and product each quantity refers to. Never present a combined total without identifying the scope.
- Treat each posted movement as an auditable event. Show its type/reason, signed quantity, product, location, timestamp, and actor when authentication provides one. Corrections should be represented by a new compensating movement; whether edits/voids are allowed is a decision below.
- Use fictional demo records and mark demo context clearly when applicable.

## Information architecture

Primary navigation, in this order:

1. Dashboard — low-stock attention, stock summary, and common actions.
2. Products — searchable catalog and product create/edit.
3. Stock — receive or issue stock; optionally choose a task entry point for the selected action.
4. Activity — searchable, filterable movement ledger.

A persistent location selector scopes dashboard figures and product stock. Activity can filter to a location or all locations. Keep the current location visible in page heading and form summary. On narrow screens, collapse navigation behind a labeled menu and retain the location selector near the page title.

## Dashboard flow and content

**Purpose:** answer “what needs attention?” and expose the common next actions.

- Header: “Inventory” and selected location (or “All locations”), with a location selector.
- Main actions: “Receive stock”, “Record stock issue”, “Add product”. These actions open focused forms and carry the selected location where relevant.
- Summary cards: product count; units on hand for the selected location; low-stock item count. Label the scope and calculation. Avoid currency totals unless a later requirement defines price semantics and explicitly wants a retail valuation; sale price multiplied by units is not accounting valuation.
- Low-stock table: product/SKU, on-hand units, reorder point, location, and a clear status. Link each row to product details. Provide a direct receiving action that preselects product and location.
- Recent activity: latest movements with type/reason, signed units, product/SKU, location, timestamp, and actor if available; “View all activity” link.
- If the location has no stock records, explain that stock appears after movements are recorded; offer “Receive stock” and “Add product”. Do not imply that an unrecorded starting balance exists.

## Product catalog and editing flow

**Search and browse**

- Search by SKU or product name. Search should be forgiving of case and surrounding whitespace; exact SKU remains visible and distinct.
- Columns/cards: product name, SKU, category (once implemented), sale price (once implemented), selected-location on-hand, reorder point, and stock status. Indicate when a location filter is active.
- Provide a concise “No products yet” state with “Add product”; a no-results state echoes the query and offers clear-search. Loading retains table headings or skeleton rows and announces the update accessibly. Errors explain that results could not be loaded and offer retry.

**Create/edit**

- Form fields: SKU, product name, category (if category schema is available), sale price (if available), reorder point, and optional description only if the product model supports it. Do not collect starting quantity on the product form: starting stock must use a receiving/opening movement so the ledger explains the balance.
- Label required fields and constraints next to fields. SKU must be non-empty and unique; name non-empty; reorder point a whole nonnegative unit count. Price precision, currency, and zero/negative-price policy require the decision below.
- Keep Save and Cancel explicit. On validation failure, preserve entered values, show an error next to each field, set focus to an error summary or first invalid field, and announce the failure. Duplicate SKU message should say the SKU is already used and preserve the entered value.
- On success, confirm “Product saved” and link to its detail page. For edits, show what fields changed if this can be generated reliably. If a product is referenced by movements, avoid implying that editing product metadata rewrites historical movement records.
- Proposed default: no product deletion in the first workflow; archive/retirement policy is open. If deletion is blocked by history, explain how to retire the product instead once that operation exists.

**Product detail**

- Identity: name, SKU, category, sale price if defined, reorder point.
- Stock by location as explicit rows, plus an all-location total only when clearly labeled “sum of locations”.
- Recent movement history for that product and a link to its full activity view.
- Actions: Edit product, Receive stock, Record stock issue. Product and relevant location may be preselected, but user confirms the location and signed quantity before submit.

## Receive stock flow

1. Start from dashboard, Stock, a low-stock row, or product detail.
2. Select product (search by SKU/name), location, and positive whole-unit quantity. Enter a reason/reference note if the final API supports it; show concise suggestions such as “Supplier delivery” without forcing invented supplier data.
3. Review summary: “Add 12 units of SKU-123 to Main Store”.
4. Submit once. Disable duplicate submission while pending and provide a visible progress state.
5. Success confirms the posted units and resulting on-hand for that location and links to the movement record.

Fields and confirmation must distinguish a quantity addition from a receipt of money or an accounts-payable entry. If no accounting/invoice integration exists, never label this as “Book purchase”, “Post bill”, or “Increase asset value”. The durable movement event should capture timestamp, actor when available, and reason/reference as data supports it.

## Sales deduction / stock issue flow

Requirements currently call for rejecting deductions above available stock; sales entry versus POS integration remains unresolved. For a manual MVP, propose the neutral task name “Record stock issue” with a required issue type/reason and a “Sale” option if approved. Do not imply an integrated checkout or payment capture.

1. Select product, location, and quantity to remove (positive units in the form; the UI communicates “Subtract” while the ledger stores a negative delta).
2. Choose or enter reason, e.g. Sale, Damage, Internal use; final reason set is a business decision.
3. Show available units before submit. If requested quantity exceeds availability, block submission and state “Only N units are available at [location]”; never allow a negative balance. If another transaction reduces stock during submission, present the server's latest available quantity and invite correction.
4. Review “Remove 2 units from Main Store” before posting; avoid asking for confirmation twice for routine low-risk deductions unless product policy requires it.
5. Success shows the signed movement and resulting balance; do not show payment totals unless an approved sales data model supports them.

## Activity / audit history

- Present an append-oriented movement list with newest first and filters for date range, product/SKU, location, movement type/reason, and actor if available. Include a clear reset action and active-filter chips.
- Each row: timestamp with timezone/context, product name and SKU, location, signed unit delta (“+12 units” / “−2 units”), resulting balance if the API supplies a trustworthy point-in-time value, reason/reference, actor if available, and stable movement ID in detail view.
- Use explicit labels: “Received +12 units”, “Sale −2 units”, “Adjustment +3 units”. Never use an unsigned quantity without indicating direction.
- A product's current balance is the sum of its movements for that location. Label it “Current on hand”; do not call it “available to sell” if reservations/holds are not modeled.
- Proposed default: posted events are not edited or deleted; a mistake is corrected with an opposite compensating event and a reason that references the original movement. The initial schema does not yet define event types, actor, reference link, or a correction relationship, so this UX depends on a schema/API decision.
- Empty states distinguish no movements at all from no movements matching filters. Loading retains filters. Error state preserves filter values and offers retry.

## Adjustments and returns

These are in the requirements but not yet specified at business-rule level. Proposed UI: an adjustment requires product, location, signed outcome represented as a positive quantity to add or a positive quantity to remove, and a required reason. Preview the resulting balance; removal cannot exceed on-hand. A return is an addition with a distinct return type/reason and optional original sale reference only if such a reference is supported. Avoid describing a return as a refund, revenue reversal, or accounting journal. Atlas must approve the adjustment reason taxonomy, whether return linkage is required, and whether posted events can ever be corrected directly.

## Shared states and interaction criteria

- **Loading:** show local progress near the affected region, retain context, and prevent repeated submits. Use `aria-busy` on updating regions where appropriate.
- **Empty:** explain what is empty, why, and the next useful action. Distinguish first-use state from filtered/no-match state.
- **Validation error:** inline field-specific text, summary for multi-field forms, focus moved to first error or summary, values retained, and programmatic association via labels/descriptions.
- **Request/server error:** plain-language statement, preserve user input, provide retry where safe, and never report success before the write is confirmed. Do not expose SQL, stack traces, or secrets.
- **Success:** state what changed, at which location, and resulting on-hand when known; provide a link to the created movement.
- **Confirmation:** use a concise review for writes with product, location, direction, and units. For destructive or irreversible actions, require a more explicit confirmation. No product deletion is proposed for MVP.
- **Permissions:** when authentication/roles are introduced, hide or disable unavailable actions consistently and explain “You can view inventory but cannot record stock changes. Contact an administrator.” Server authorization remains authoritative. Sign-in/session-expiry states must preserve a safe return path and never imply unsaved writes succeeded. Role names and permission matrix are open decisions.
- **Keyboard:** all controls reachable in logical DOM order; visible focus ring; no keyboard traps; tables usable without pointer; dialogs trap focus while open and return focus to trigger on close; Escape closes non-destructive dialogs; Enter submits only when safe and expected.
- **Screen readers:** semantic headings, table captions/headers, explicit form labels, text status in addition to color/icons, live announcement for save/error, and accessible names for icon-only buttons.
- **Contrast and motion:** meet WCAG 2.2 AA contrast for text and controls; never rely only on red/green; respect reduced-motion preference.
- **Mobile:** reflow at narrow widths without horizontal page scrolling; replace dense tables with labeled stacked rows/cards where useful; keep primary actions reachable; forms use appropriate input modes and adequately sized targets; sticky controls must not cover keyboard focus or content.
- **Responsive thresholds:** use content-driven breakpoints. At small widths, stack summary cards and filters, move secondary filters into a disclosure, and keep SKU and signed quantity visible in activity rows.

## Data/API mapping and current constraints

| UI concept | Current or target data concept | Presentation rule |
|---|---|---|
| Product identity | `products.id`, `sku`, `name` | Keep SKU visible in search results and movement rows. |
| Reorder attention | `products.reorder_point` | Compare with current on-hand within the selected location only if the business defines that threshold per location; otherwise clarify whether threshold is global. |
| Location | `locations.id`, `name` | Always show location on balances and stock writes. |
| Stock event | `stock_movements.product_id`, `location_id`, `quantity_delta`, `reason`, `created_at` | Render delta with sign and reason. Current schema has no actor, movement category, external reference, or correction link. |
| Balance | `stock_balances` view, sum of movement deltas grouped by product/location | Label as current on-hand. Empty sum may need to display as zero even though the view contains no row. |
| Category and price | `products.category_id`, `categories.name`, and `products.sale_price` are available after migration 002 | Category and nonnegative decimal amount are editable. Currency is not configured; do not imply a specific currency or accounting valuation. |
| Availability | Not modeled beyond movement-derived balance | Do not imply reservations, in-flight orders, or sellable stock beyond the recorded on-hand count. |

## Decisions for Atlas before final implementation

1. **Auth and permissions:** public demo, authenticated single user, or roles? Which roles may edit catalog, receive, issue, adjust, and view activity? Can actor identity be persisted?
2. **Sales integration:** manual inventory issue or POS integration? If manual, is “Sale” a movement type and what sale fields (if any) are recorded? Explicitly decide that inventory movements are not payment/accounting records unless integrated.
3. **Price presentation:** currency policy; whether sale price is only display metadata or used in any report. The catalog stores a nonnegative decimal amount with two fractional digits.
4. **Reorder point scope:** global per product or separate per product/location?
5. **Ledger policy:** immutable posted movements with compensating events? Which fields/IDs are retained for audit and correction?
6. **Reasons and references:** allowed reason values, free-text policy, whether supplier documents, sale references, or return links are in scope.
7. **Adjustment and return semantics:** who can perform them, required reason, and reference requirements.
8. **Product retirement:** how to handle discontinued products referenced by movement history.

## Review checklist for implemented screens

- User can tell the selected location and the unit direction of every stock action.
- Catalog search works by name and SKU; duplicate SKU, empty name, invalid reorder point, and invalid price messages are clear.
- Product form cannot silently create stock; all quantity changes lead to traceable movement records.
- Low-stock comparison uses the approved threshold scope and includes zero-stock items.
- A deduction above current on-hand is blocked with the latest available amount.
- Success and error states are truthful under failed or duplicated requests.
- Activity history makes product, SKU, location, signed delta, reason, and timestamp easy to scan.
- Keyboard, screen-reader, contrast, mobile reflow, and focus behavior satisfy the criteria above.
