# Retail inventory requirements

## Initial scope

Manage retail products using unique SKUs, names, categories, sale prices, reorder points, and stock by location. Record receiving, sales deductions, returns, and adjustments with an auditable reason and timestamp.

## First working milestone

- [x] Create and edit products with unique SKU validation; deactivate without deleting history.
- [ ] Receive stock and record a movement.
- Record a sale deduction; reject deductions exceeding available stock.
- View stock balances and low-stock products.
- Search products by name or SKU.

The product catalog UI and save path are implemented. Database-backed saves require migration 003 and provisioning `inventory_runtime`; runtime use is limited to local development because authentication is not implemented. Receiving, sale deductions, balances, low-stock views, and tests remain to be completed.

## Portfolio evidence

Demonstrate input validation, SQL constraints, transactional stock changes, concurrency tests, automated CI, and documented human review of AI-generated changes. Use fictional retail data for demonstrations.

## Pending decisions

Public GitHub repository: sysinfo7/Inventory_System. Pending: hosting, authentication roles, currency policy, and whether sales entry is manual or integrated with a point-of-sale system. The current schema supports categories and sale-price amounts; currency and financial valuation remain undefined.


