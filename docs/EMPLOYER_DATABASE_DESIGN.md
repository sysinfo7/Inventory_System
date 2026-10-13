# Retail Inventory Database Design

**Portfolio overview · PostgreSQL 17 · TypeScript/Next.js application**  
**Maintained project document · Last updated 2026-10-13**

## Purpose

This document explains the relational database design for a retail inventory portfolio project. It is written for reviewers who want to understand how catalog data, stock by location, movement history, audit events, and sign-in fit together. The SQL source of truth is in migrations [`001`](../db/001_initial.sql) through [`010`](../db/010_authenticated_actor_foreign_keys.sql); notable files include the product and inventory controls, demo seed, auth/session schema, authenticated audit function, and actor foreign keys. Operational commands are in [`DATABASE.md`](DATABASE.md).

The current web application includes catalog, stock, movement activity, authentication, and role-based permissions. `/activity` displays verified actors for new movements; pre-authentication demo rows have a NULL actor. Migrations 008-010 add application users, sessions, authenticated product auditing, and actor foreign keys. Role enforcement is in trusted app server code; PostgreSQL connection roles remain separate.

## Entity relationship diagram

In this diagram, `PK` means primary key, `FK` means foreign key, and `UK` means a unique key or unique index. The product-to-category relationship is optional on the product side: a product can have no category or one category; a category can classify zero or more products.

```mermaid
erDiagram
    CATEGORIES o|--o{ PRODUCTS : classifies
    PRODUCTS ||--o{ STOCK_MOVEMENTS : has
    LOCATIONS ||--o{ STOCK_MOVEMENTS : records_at
    PRODUCTS ||--o{ INVENTORY_STOCK : has_balance
    LOCATIONS ||--o{ INVENTORY_STOCK : holds_balance
    APP_USERS ||--o{ APP_SESSIONS : authenticates
    APP_USERS o|--o{ STOCK_MOVEMENTS : records
    APP_USERS o|--o{ INVENTORY_AUDIT_LOG : acts

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
    APP_USERS {
        uuid id PK
        text email UK
        text display_name
        text password_hash
        text role
        boolean active
        timestamptz created_at
        timestamptz updated_at
    }
    APP_SESSIONS {
        uuid id PK
        uuid user_id FK
        text token_hash UK
        timestamptz expires_at
        timestamptz created_at
    }
```

`INVENTORY_AUDIT_LOG` is intentionally not drawn with a normal entity foreign-key connector for the entity itself: it stores a polymorphic `(entity_type, entity_id)` reference for product and stock-movement audit events, which PostgreSQL does not enforce as a single foreign key. Actor IDs are real nullable foreign keys to `APP_USERS`; they stay NULL on pre-authentication seed rows and point to the signed-in app user for new writes.

## Tables and keys

| Table | Purpose and important fields | Key and integrity rules |
| --- | --- | --- |
| `categories` | Reusable product classification with a name. | Identity primary key; trimmed, case-insensitive unique name. |
| `products` | Retail catalog record: SKU, name, optional category, reorder point, current sale price, active flag, creation time. | Identity primary key; nonblank SKU and name; SKU is case-insensitively unique after trimming; category is an optional foreign key. Price is nullable and nonnegative; reorder point is nonnegative. |
| `locations` | Store, stockroom, or other inventory location. | Identity primary key; nonblank unique name. |
| `inventory_stock` | Current cached quantity for one product at one location. | Composite primary key `(product_id, location_id)`; both columns are foreign keys; quantity cannot be negative. |
| `stock_movements` | Append-only record of a quantity change, including reason, type, optional request/actor IDs, and optional event unit price. | Identity primary key; required product and location foreign keys; nonzero signed quantity; request ID is unique when supplied. |
| `inventory_audit_log` | Before/after product records and stock-movement audit events. | Identity primary key; audit rows reject ordinary update/delete/truncate operations. Its polymorphic entity reference is not a foreign key. |
| `save_product` | Controlled database function used by the catalog create/edit form. | Security-definer function with fixed search path; validates product fields; granted to `inventory_app`, not `PUBLIC`. Product triggers append audit changes. |
| `stock_balances` | Read view exposing product, location, and quantity from `inventory_stock`. | A view, not a stored table or independent source of truth. |
| `schema_migrations` | Migration version, SHA-256 checksum, and application time. | Migration version is the primary key; the runner rejects edits to a migration already recorded as applied. |
| `app_users` | Application identity, normalized unique email, scrypt password hash, role, and active state. | UUID primary key; email case-insensitively unique; role constrained to the defined role set. |
| `app_sessions` | Hashed opaque login token with user and expiry. | UUID primary key; user foreign key; token hash unique; raw cookie token is never persisted. |

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
    E -- No prior movement --> G[Lock product row FOR SHARE]
    C -- No --> G
    G --> H{Product active?}
    H -- No --> X[Reject inactive or missing product]
    H -- Yes --> I[Create balance row if absent]
    I --> J[Lock product/location balance row]
    J --> K{Would quantity become negative?}
    K -- Yes --> L[Reject; transaction rolls back]
    K -- No --> M[Update cached balance]
    M --> N[Insert stock movement]
    N --> O[Trigger appends audit event with verified actor UUID]
    O --> P[Return movement ID]
```

The function validates a nonzero delta, supported movement type, movement direction for receiving/returns/sales, and a nonblank reason. Migration 005 locks the product row `FOR SHARE` and requires it to be active, preventing a concurrent deactivation from racing with a new stock movement. The balance row lock serializes writes for the same product/location. An optional request UUID provides idempotency for matching retries and rejects reuse for different movement details. Product insert/update/delete triggers record before/after product data; a stock-movement trigger records new movement events. Application actions pass the user ID resolved from the verified server session; legacy seed rows and database-only checks can retain a NULL actor.

## Security and audit boundaries

Migration 002 creates `inventory_app` as a `NOLOGIN` role with limited reads and stock-function execution; migration 003 adds product-function execution. Security-definer routines are owned by the separate `inventory_function_owner` `NOLOGIN` role with only the table and sequence privileges they need. Their fixed `search_path` is `pg_catalog, public, pg_temp`, with the temporary schema last. The product form calls `save_product` with parameterized values using `APP_DATABASE_URL`; `inventory_runtime` is provisioned as a separate login that inherits the group role. The route and write action are disabled outside local development. This is a useful local boundary, not a claim of production-grade security.

Audit actor IDs are nullable. Application actions resolve the actor from a database-validated server session and pass it to the controlled database function; PostgreSQL does not independently authenticate that application identity. Migration 002 records events after its triggers are installed and does not backfill earlier product or movement events. Movement and audit rows reject ordinary updates/deletes, with truncate guards for those history tables; database owners and administrators can change or bypass these controls. Product changes remain allowed and generate audit events when their triggers execute. Production deployment has not been implemented or reviewed.

This is an inventory history, not a complete financial accounting ledger. It does not implement double-entry bookkeeping, inventory valuation, reconciliation, close periods, payments, taxes, or compliance controls. See [`SECURITY.md`](SECURITY.md) for additional limits and deployment work.

## Migration and reproducibility

Schema changes are saved as ordered SQL files in `db/`. `npm run db:migrate` serializes migration runs with a PostgreSQL advisory lock and records each migration checksum in `schema_migrations`. A changed, already-applied migration is rejected; new schema work belongs in a new numbered file. `npm run db:check` verifies that the configured PostgreSQL connection works.

To apply or upgrade the local development database from PowerShell, run `scripts/setup-database.ps1`. This project documents clean reset, backup, and restore procedures in [`DATABASE.md`](DATABASE.md). The reset deletes the local development volume and must only be used when that data is disposable.

## Current implementation status

- Migration 001 defines the initial products, locations, movements, and aggregate balance view.
- Migration 002 defines categories, normalized SKU uniqueness, cached balances, typed movement events, audit triggers, the controlled stock function, and group-role grants.
- Migration 003 defines the controlled catalog-write function and restricted function owner. The owner reported migrations 003 and `inventory_runtime` provisioning succeeded.
- Migration 004 inserts `Demo Store` only if no location exists.
- Migration 005 updates the stock function to require an active product while holding a `FOR SHARE` lock.
- Migration 006 ensures both demo locations exist, even when migration 004 skipped `Demo Store` because a location was already configured.
- Migration 007 seeds three fictional products and eight audited movement entries through the controlled product and stock functions, preserving existing matching rows.
- `/stock` implements selected-location active-product balances, reorder attention, stock receipt, sellable returns, manual sale deductions, and manager/administrator count adjustments. `/activity` implements location/type/text filters and a newest-first list capped at 200 movements.
- Migrations through 010 and database connection are verified locally. The expanded rollback-only stock and auth checks passed locally for returns, adjustments, clerk/manager boundaries, and audit writes. The owner has confirmed administrator sign-in and role test accounts; GitHub Actions run #10 passed the prior production build, auth/permission checks, and CI stock concurrency test ([run details](https://github.com/sysinfo7/Inventory_System/actions/runs/38481389156)). A fresh hosted run is needed for the latest changes. Backup/restore rehearsal and deployment remain future work.
- No sample production or customer information is included. Use fictional data in demos.

Update this document whenever a migration changes a table, column, key, relationship, constraint, index, database function, trigger, role grant, or implementation status. Keep the diagram and relationship descriptions aligned with the SQL files, and clearly separate implemented behavior from planned application features. It is also linked from the README and database operations guide.
