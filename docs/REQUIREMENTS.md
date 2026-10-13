# Retail inventory requirements

## Initial scope

Manage retail products using unique SKUs, names, categories, sale prices, reorder points, and stock by location. Record receiving, sales deductions, returns, and adjustments with an auditable reason and timestamp.

## First working milestone

- Create and edit products with unique SKU validation.
- Receive stock and record a movement.
- Record a sale deduction; reject deductions exceeding available stock.
- View stock balances and low-stock products.
- Search products by name or SKU.

## Portfolio evidence

Demonstrate input validation, SQL constraints, transactional stock changes, concurrency tests, automated CI, and documented human review of AI-generated changes. Use fictional retail data for demonstrations.

## Pending decisions

Public GitHub repository: sysinfo7/Inventory_System. Pending: hosting, authentication roles, and whether sales entry is manual or integrated with a point-of-sale system. The initial schema must be extended for categories and prices before the catalog milestone.


