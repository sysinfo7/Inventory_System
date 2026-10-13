# Retail Inventory Database Design

**Portfolio overview · PostgreSQL 17 · TypeScript/Next.js application**  
**Maintained project document · Last updated 2026-10-13**

## Purpose

This document explains the relational database design for a retail inventory portfolio project. It is written for reviewers who want to understand how catalog data, stock by location, movement history, and audit events fit together. The SQL source of truth is in [`db/001_initial.sql`](../db/001_initial.sql) and [`db/002_inventory_controls.sql`](../db/002_inventory_controls.sql); operational commands are in [`DATABASE.md`](DATABASE.md).

The schema is designed to support those workflows. The current web application is still a project landing page: it does not yet provide catalog or stock-management screens, authenticate users, or call the database stock-write function. Migration 002 must be applied to the local database before its additions exist there.

## Entity relationship diagram

In this diagram, `PK` means primary key, `FK` means foreign key, and `UK` means a unique key or unique index. The product-to-category relationship is optional on the product side: a product can have no category or one category; a category can classify zero or more products.

```mermaid
erDiagram
    CATEGORIES o|--o{ PRODUCTS : classifies
    PRODUCTS ||--o{ STOCK_MOVEMENTS : has
    LOCATIONS ||--o{ STOCK_MOVEMENTS : records_at
    PRODUCTS ||--o{ INVENTORY_STOCK : has_balance
    LOCATIONS ||--o{ INVENTORY_STOCK : holds_balance

    CATEGORIES {
        bigint id PK
        text name UK
    }
    PRODUCTS {
        bigint id PK
        text sku UK
        text name
        bigint category_id FK "nullable"
        integer reorder_point
        numeric sale_price "nullable, current catalog price"
        boolean active
        timestamptz created_at
    }
    LOCATIONS {
        bigint id PK
        text name UK
    }
    INVENTORY_STOCK {
        bigint product_id PK, FK
        bigint location_id PK, FK
        bigint quantity
        timestamptz updated_at
    }
    STOCK_MOVEMENTS {
        bigint id PK
        bigint product_id FK
        bigint location_id FK
        bigint quantity_delta
        text movement_type
        text reason
        uuid actor_id "nullable"
        uuid request_id UK "nullable, unique when present"
        numeric unit_price "nullable event price"
        timestamptz created_at
        timestamptz occurred_at
    }
    INVENTORY_AUDIT_LOG {
        bigint id PK
        text entity_type
        bigint entity_id
        text action
        uuid actor_id "nullable"
        uuid request_id "nullable"
        jsonb before_data "nullable"
        jsonb after_data "nullable"
        timestamptz occurred_at
    }
```

`INVENTORY_AUDIT_LOG` is intentionally not drawn with a normal foreign-key connector: it stores a polymorphic `(entity_type, entity_id)` reference for product and stock-movement audit events. PostgreSQL does not enforce that pair as a foreign key. Actor IDs are also optional UUIDs without a user table or verified identity relationship in this project.

## Tables and keys

| Table | Purpose and important fields | Key and integrity rules |
| --- | --- | --- |
| `categories` | Reusable product classification with a name. | Identity primary key; trimmed, case-insensitive unique name. |
| `products` | Retail catalog record: SKU, name, optional category, reorder point, current sale price, active flag, creation time. | Identity primary key; nonblank SKU and name; SKU is case-insensitively unique after trimming; category is an optional foreign key. Price is nullable and nonnegative; reorder point is nonnegative. |
| `locations` | Store, stockroom, or other inventory location. | Identity primary key; nonblank unique name. |
| `inventory_stock` | Current cached quantity for one product at one location. | Composite primary key `(product_id, location_id)`; both columns are foreign keys; quantity cannot be negative. |
| `stock_movements` | Append-only record of a quantity change, including reason, type, optional request/actor IDs, and optional event unit price. | Identity primary key; required product and location foreign keys; nonzero signed quantity; request ID is unique when supplied. |
| `inventory_audit_log` | Before/after product records and stock-movement audit events. | Identity primary key; audit rows reject ordinary update/delete/truncate operations. Its polymorphic entity reference is not a foreign key. |
| `stock_balances` | Read view exposing product, location, and quantity from `inventory_stock`. | A view, not a stored table or independent source of truth. |
| `schema_migrations` | Migration version, SHA-256 checksum, and application time. | Migration version is the primary key; the runner rejects edits to a migration already recorded as applied. |

`stock_movements.created_at` is retained from the initial schema; `occurred_at` was added for the effective event time. New movements set both when written through the database function. Existing rows receive a default `occurred_at` during migration 002.

## Normalization and the balance projection

The catalog is split into products, categories, and locations so repeated descriptive data is stored once and referenced by keys. Stock movement facts refer to product and location identities rather than repeating their names. This reduces update anomalies when a product or location name changes and provides referential integrity for movement records.

The movement table is the historical record of quantity changes. `inventory_stock` is a deliberate cached projection keyed by product and location, rather than another independently edited business fact. The `record_stock_movement` function updates this projection and appends the movement in the same transaction. The view `stock_balances` gives readers a stable balance-shaped query. Keeping the projection makes current-balance reads straightforward while preserving a movement trail for explaining how stock changed.

`products.sale_price` represents the current catalog price; `stock_movements.unit_price` can preserve a price associated with a particular movement. That distinction avoids rewriting old event details when a catalog price changes. The schema does not yet define a full valuation policy.

## Stock transaction and audit flow

```mermaid
flowchart TD
    A[Caller submits product, location, signed delta, type, reason] --> B[Validate required fields and movement direction]
    B --> C{Request UUID supplied?}
    C -- Yes --> D[Lock request key and check for a previous movement]
    D --> E{Same request details?}
    E -- Yes --> F[Return original movement ID]
    E -- Different details --> X[Reject request-key reuse]
    E -- No prior movement --> G[Create balance row if absent]
    C -- No --> G
    G --> H[Lock product/location balance row]
    H --> I{Would quantity become negative?}
    I -- Yes --> J[Reject; transaction rolls back]
    I -- No --> K[Update cached balance]
    K --> L[Insert stock movement]
    L --> M[Trigger appends audit event]
    M --> N[Return movement ID]
```

The function validates a nonzero delta, supported movement type, movement direction for receiving/returns/sales, and a nonblank reason. The row lock serializes concurrent writes for the same product/location. An optional request UUID provides idempotency for matching retries and rejects reuse for different movement details. Product insert/update/delete triggers record before/after product data; a stock-movement trigger records new movement events.

## Security and audit boundaries

The migration creates `inventory_app` as a `NOLOGIN` role. It grants reads on designated catalog/history objects and execution of the controlled movement function. A trusted operator would need to provision a login and membership. The function is defined with `SECURITY DEFINER` and a fixed `search_path`; application authentication and a server route that calls it have not been built.

Audit actor IDs are nullable and caller-controlled. They do not verify a human identity. Migration 002 records events after its triggers are installed and does not backfill earlier product or movement events. Movement and audit rows reject ordinary updates/deletes, with truncate guards for those history tables; database owners and administrators can change or bypass these controls. Product changes remain allowed and generate audit events when their triggers execute.

This is an inventory history, not a complete financial accounting ledger. It does not implement double-entry bookkeeping, inventory valuation, reconciliation, close periods, payments, taxes, or compliance controls. See [`SECURITY.md`](SECURITY.md) for additional limits and deployment work.

## Migration and reproducibility

Schema changes are saved as ordered SQL files in `db/`. `npm run db:migrate` serializes migration runs with a PostgreSQL advisory lock and records each migration checksum in `schema_migrations`. A changed, already-applied migration is rejected; new schema work belongs in a new numbered file. `npm run db:check` verifies that the configured PostgreSQL connection works.

To apply or upgrade the local development database from PowerShell, run `scripts/setup-database.ps1`. This project documents clean reset, backup, and restore procedures in [`DATABASE.md`](DATABASE.md). The reset deletes the local development volume and must only be used when that data is disposable.

## Current implementation status

- Migration 001 defines the initial products, locations, movements, and aggregate balance view.
- Migration 002 defines categories, normalized SKU uniqueness, cached balances, typed movement events, audit triggers, the controlled write function, and role grants.
- The repository includes the SQL and repeatable migration runner; the owner previously confirmed the initial database setup. The agent could not independently connect to the owner's database to apply or verify migration 002.
- The web app currently shows a project landing page. Catalog, stock-entry, authentication, and reporting screens remain future work.
- No sample production or customer information is included. Use fictional data in demos.

Update this document whenever a migration changes a table, column, key, relationship, constraint, index, database function, trigger, role grant, or implementation status. Keep the diagram and relationship descriptions aligned with the SQL files, and clearly separate implemented behavior from planned application features.
