# User manual

## What you can use today

The app includes a local product catalog, multi-location stock page, supplier directory, purchase orders, activity history, sign-in, and role-based permissions. The catalog supports search, active/inactive filters, add/edit, and deactivate. `/stock` shows current balances for active products at the selected location, flags quantities at or below each product's reorder point, and provides receiving, customer-return, sale-deduction, and manager/admin count-adjustment forms. Purchasing tracks supplier orders and receipts by quantity; it does not store supplier costs, currency, invoices, or payment/accounting records. `/activity` filters recent signed movements and shows the actor for newly authenticated changes. Administrators can create, deactivate, and reset accounts with Administrator, Manager, Clerk, or Read-only roles. New accounts and reset accounts must replace their temporary password before protected inventory access. Changing a role or deactivating an account revokes all of that user's sign-in sessions. The overview page links to the main workflows.

An optional public employer-demo mode is disabled by default. For a local preview, set `$env:PUBLIC_DEMO_MODE = 'true'` in PowerShell before `npm run dev`, then sign out or use a private browser window. Anonymous visitors can browse the product catalog, stock, activity, supplier names, and submitted/received purchase orders. Supplier contact details and private notes are hidden, staff names are anonymized, and draft/cancelled orders are not listed. All changes and account-management screens still require a signed-in role. Before any public deployment, use an isolated database populated only with fictional records; enabling this flag publishes its selected inventory data.

For the hosted employer demo, use the separate [Vercel and Neon deployment guide](DEPLOYMENT_VERCEL_NEON.md). Migration 022 adds a fictional supplier, a completed bottle receipt, and an open coffee order to a clean database; it does not copy local data.

Migrations through 021 are applied to the local database after the October 14 clean reset, and the rollback-only purchasing verifier passed. The reset seeded two locations, three fictional products, and eight sample movements. The one-off guide receipt shown in the screenshots was removed by the reset and is no longer in the current activity history. The live purchasing walkthrough then added a fictional supplier and completed `PO-00000007` for five coffee units delivered to Demo Outlet: two units were recorded in the first receipt and three in the second. Demo Outlet now has 15 coffee units; Demo Store remains at 7. The two receipt movements are linked to the order and attributed to the signed-in administrator. Seed movement actors are blank; new app-recorded changes identify the signed-in user. A separate sample order, `PO-00000018`, contains three fictional Summit Steel Water Bottles for Demo Store with an expected delivery date of October 23, 2026. It is submitted and ready to receive; its 0/3 quantity progress confirms stock has not changed. The manual now includes completed-order, draft, submitted-order, receipt-form, and order-register screenshots.

## Start the local project

From the repository folder in PowerShell, create `.env` from `.env.example`, use the same local database password for `DB_PASSWORD` and `DATABASE_URL`, and set a different URL-safe random password of at least 32 characters in `APP_DATABASE_URL`. Install the locked dependencies:

```powershell
Copy-Item .env.example .env
# Edit .env locally; the app password must be distinct from the migration password.
npm ci
```

To generate and save a separate application password without displaying it, run the local helper from the project folder:

```powershell
.\scripts\configure-app-url.ps1
```

It writes only to the git-ignored `.env` and refuses to replace an existing app URL. Do not share or commit `.env`.

Apply pending migrations, provision the limited app login if it is not already provisioned, run the rollback-only stock verification script, and start the local web server:

```powershell
.\scripts\setup-database.ps1
npm run db:provision-app
npm run db:verify-stock
npm run auth:bootstrap
npm run dev
```

`db:verify-stock` checks receipt, sale, idempotent retry, conflicting request token, oversell rejection, inactive product rejection, resulting balance, and an audit row in a transaction that is rolled back. Run `npm run auth:bootstrap` once to create a personal admin account; it asks for a private 14-character-or-longer password and doesn't echo it. The app and PostgreSQL bind to loopback for local use. Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Login throttling allows up to eight attempts per email/client pair and 100 attempts per local client in 15 minutes. If the limit is reached, wait for the retry period before signing in again. In a second PowerShell window from the project folder, `npm run auth:verify` creates a temporary account and checks sign-in, permissions, logout, login throttling, response headers, and actor audit attribution; it removes the account with the local database administrator connection. After upgrading from an earlier verifier that could leave test rows, run `npm run auth:cleanup-checks` once. See [DATABASE.md](DATABASE.md) for migration, role, backup, restore, and destructive reset details.

Stop the web server with `Ctrl+C`. To stop PostgreSQL while keeping local data, run:

```powershell
docker compose stop
```

## Product catalog walkthrough

1. Open the home page and select **Open product catalog**, or choose **Products** in the navigation.
2. Search by product name or SKU and choose Active products, Inactive products, or All statuses.
3. Select **Add product** and enter a unique SKU, product name, optional category and sale price, reorder point, and status.
4. To edit or deactivate, select **Edit** on a product. Set its status to Inactive to keep it out of the active list while preserving the product and its history.
5. Save the form. Duplicate SKUs, invalid prices or reorder points, and unavailable categories are rejected with a useful message.

Sale prices are decimal amounts; no currency has been configured. Editing catalog details never creates or changes stock. Stock changes are recorded as movement history through the separate stock workflow.

## Sign in and test role permissions

Apply current migrations and confirm the runtime DB login is provisioned. Create your personal administrator account locally; the command prompts for email, display name, and a unique password and never saves the password in the repository:

```powershell
npm run auth:bootstrap
```

Start `npm run dev`, open [http://127.0.0.1:3000/login](http://127.0.0.1:3000/login), and sign in. The **Permissions** page displays the role matrix. Test accounts are optional. Create fictional Manager, Clerk, and Read-only accounts:

```powershell
npm run auth:seed-test-users
```

Type `YES` at the prompt. It prints generated temporary passwords once in the local terminal. Save them somewhere private if needed; they are not stored in this manual or Git. Each test user must replace the temporary password at first sign-in before using inventory pages. Run the command again to rotate these test passwords. Their account names are `manager@inventory-demo.invalid`, `clerk@inventory-demo.invalid`, and `viewer@inventory-demo.invalid`.

Sign out and try each test account. Manager can edit products, record stock, and adjust counted inventory. Clerk can receive stock, record sellable customer returns and manual sale deductions, but cannot edit products or correct counts. Read-only can inspect catalog, stock, and activity, but cannot change records. Try opening `/products/new` while read-only: the server redirects to a permission-required page. Server actions also check permission when submitted, so hidden buttons are not the security boundary.

Sessions last eight hours and use HttpOnly/SameSite cookies; signing out revokes the server-side session. Passwords use salted scrypt hashes. To change your password, choose **Account** in the top navigation, enter your current password, then enter and confirm a new password of at least 14 characters. The change signs out every session; sign in again with the new password. Password changes share the sign-in attempt limit. A restricted database trigger records the time, account subject, and event type without storing password data.

To reset another active account, open **Users**, expand **Reset password** on that account's row, enter and confirm a temporary password of at least 14 characters, then choose **Set temporary password**. Share the temporary password with the user through a secure channel outside the app; the app will not display it again. Their existing sessions are revoked. At their next sign-in they go directly to **Change password**, and protected pages remain unavailable until they set their own password. Administrators cannot reset their own account through this form. Email-based password recovery and persistent account lockout remain future work. See [SECURITY.md](SECURITY.md).

If you are locked out of the only active administrator, run `npm run auth:reset-admin-local` in an interactive PowerShell window from the project folder. The command shows the active administrator sign-in email(s); choose the right one, then enter and confirm a new temporary password at the hidden prompts. This local recovery path only accepts a loopback database, revokes old sessions, and requires you to replace the temporary password after signing in. The audit event has no actor UUID because there was no signed-in administrator to attribute it to. Do not share the temporary password; the tool does not display or store it in plaintext. If login throttling is active, wait for its retry period before signing in.

## Suppliers and purchase orders

All signed-in roles can view **Suppliers** and **Purchase orders**. Managers and administrators can create/edit suppliers, make draft orders, submit them, and cancel an open order. Only administrators can deactivate/reactivate suppliers. Clerks, managers, and administrators can record purchase-order receipts. Read-only users have no write controls. The server and the database functions both check purchasing roles.

First add a supplier from **Suppliers**. Enter a supplier name; contact name, email, phone, and notes are optional. Do not enter bank/payment/tax information. A supplier can be deactivated without deleting old orders. Existing orders stay visible after supplier deactivation, but new orders and submission of drafts require an active supplier.

Choose **Purchase orders** → **Create purchase order**. Search suppliers by name and choose one; search active products by name or SKU. Choose a delivery location, optionally enter an expected delivery date and notes, then add one or more distinct products with positive whole-unit quantities. Save the order as a draft. Drafts do not reserve or change stock. Reopen the generated `PO-########` record to edit quantities, then check the order details and confirm **Submit purchase order**. Submission locks the supplier, destination, products, and quantities; no stock movement is recorded yet.

For an inbound delivery, open a submitted or partially received order. Enter the number of each product actually received (zero is allowed per line; at least one line must be positive), and optionally add a packing-slip reference and receipt note. **Record receipt** updates on-hand inventory at the order's destination and appends stock movement and purchasing audit history in the same transaction. The screen shows received/ordered/remaining quantities and receipt history. Repeating the exact same request is safe; it will not add stock twice. Over-receipts, inactive products, and lines from another order are rejected. When all ordered units arrive, the order becomes **Completed** automatically.

An open order may be cancelled with a required reason and explicit confirmation. Already received units remain in inventory and in receipt history; only the unreceived remainder is closed. A cancelled order cannot be received again. Use the order's **View activity** link to find its stock movements. Purchase orders do not include costs, currency, supplier invoices, taxes, payments, or accounting entries.

To exercise the full purchasing workflow against local PostgreSQL and roll back all test records afterward, run:

```powershell
npm run purchasing:verify
```

The script checks role gates, supplier-name normalization, draft/no-stock behavior, partial and final receipts, identical retry, over-receipt and invalid-input rejection, cancellation history, actor attribution, and database grants. It will refuse to connect to a non-local database. GitHub Actions also runs `purchasing:verify-concurrency` against its disposable PostgreSQL service; that test holds the order lock until two receipt sessions are waiting, then confirms only one of two competing four-unit receipts is accepted against a five-unit order. The test leaves fictional fixtures only in that disposable CI database. Completed-order, draft, submitted-order, receipt-form, and order-register captures are included below.

## Stock on hand and recording a movement

Open `/stock`. Choose a location and select **Show stock** to view active products, current on-hand counts, reorder points, and reorder attention for that location. Reorder attention means the location's current on-hand quantity is at or below the product's reorder point; it does not include reservations or open orders.

The local demo has two locations. **Demo Outlet** has 10 coffee units, 13 trail-mix units, and 0 water bottles. **Demo Store** has 7 coffee units and 8 water bottles. All other sample product/location balances start at zero. The three sample items are Northstar Coffee Beans, Crisp Orchard Trail Mix, and Summit Steel Water Bottle; their SKUs start with `DEMO-`.

To receive stock, record a customer return, or record a manual sale deduction, choose the location and active product, enter a positive whole number of units, and provide a reason. Only return goods that are suitable to put back into sellable inventory; a return adds units, while the sale action stores a negative quantity delta. If a sale would make stock negative, the database rejects it and the page reports the latest available quantity.

Managers and administrators can also use **Inventory adjustment** to correct a physical count. Choose whether the correction increases or decreases on-hand, enter the positive number of units, and explain the count or correction in the reason. The database stores the resulting signed quantity delta. A decrease cannot take stock below zero, zero-unit changes are rejected, and adjustments remain in the append-only movement/audit history. Clerks do not have this permission. Inactive products cannot receive new movements after migration 005 is applied. Each submission uses a request UUID so an identical retry does not create a duplicate movement.

These are inventory quantity records only. They do not process payments, record a POS sale, or create accounting entries. New stock entries carry the signed-in user's ID; old seed movements have no user and display as legacy entries.

## Movement activity

Open `/activity` to see the newest stock movements first. Filter by location, movement type, recorded-by user (or legacy entries without an actor), and text matching product name, SKU, or reason. **From date** and **Through date** are inclusive UTC dates; enter either or both to narrow the time period. If the start date is after the end date, the date filters are cleared and the page explains the correction. Results show UTC time, product/SKU, location, movement type, signed units, reason, and the recorded-by actor when available, up to 200 matching rows.

## Database stock operation

The app calls the controlled function `record_stock_movement`. It validates movement direction and reason, handles idempotent request UUIDs, checks that the product is active under a `FOR SHARE` lock, then locks the cached balance row. It rejects a negative result and updates `inventory_stock` while appending the movement record in one database statement transaction. A trigger appends an audit event.

```mermaid
flowchart TD
    A[App supplies product, location, positive units, type, reason, request UUID, verified user actor] --> B[Validate fields and direction]
    B --> C[Match request UUID for safe retry]
    C --> D[Lock product row FOR SHARE]
    D --> E{Product active?}
    E -- No --> F[Reject]
    E -- Yes --> G[Lock product/location balance row]
    G --> H{New quantity at least zero?}
    H -- No --> I[Reject; statement rolls back]
    H -- Yes --> J[Update cached quantity and append movement]
    J --> K[Audit trigger appends event]
    K --> L[Return movement ID]
```

The expanded local check passed for returns, both adjustment directions, idempotent retries, zero and oversell rejection, and audit rows; it rolled back its test transaction. The sample seed data starts with eight movements across both locations (four receiving entries and four sale deductions); filtering activity to Demo Store initially returns four rows. The user-guide screenshot documents a separate receiving movement that was later removed by the clean reset. Application-created movements include the signed-in actor. The expanded auth verifier also passed for clerk return access and manager-only adjustment visibility. All CI checks passed for release `v1.0.0` on [main](https://github.com/sysinfo7/Inventory_System/actions/runs/38491097632) and [the release tag](https://github.com/sysinfo7/Inventory_System/actions/runs/38491097851).

## Screenshots

These captures show the running local application with fictional demo data. They are evidence of the interface, not proof of a production deployment. No passwords, email addresses, or user-management records are shown.

### Overview and catalog

![Signed-in overview](screenshots/home-desktop.jpg)

![Product catalog](screenshots/catalog.jpg)

![Add-product form](screenshots/product-form.jpg)

![Required-field validation on the product form](screenshots/product-form-validation.jpg)

### Stock and audit history

![Stock on hand at Demo Outlet](screenshots/stock-on-hand.jpg)

![Receiving and customer-return forms](screenshots/stock-movement.jpg)

![Sale deduction and manager inventory adjustment forms](screenshots/stock-adjustment.jpg)

![Stock receipt form in a narrow mobile viewport](screenshots/stock-mobile.jpg)

These narrow-screen images document the stock receiving layout and its success state. The one-unit guide receipt they show was removed during the clean database reset; it is not part of the seed data.

![Successful one-unit stock receipt confirmation in a narrow mobile viewport](screenshots/stock-confirmation.jpg)

![Filtered inventory movement history](screenshots/activity.jpg)


### Permissions

![Role and permission matrix](screenshots/permissions.jpg)

### Purchasing

![Completed purchase order showing supplier, destination, and received quantities](screenshots/purchase-order-detail.png)

This fictional example shows `PO-00000007` completed after two receipts totaling five coffee units at Demo Outlet. The activity link opens the movements connected to the receipts.

![Saved draft purchase order with no stock change](screenshots/purchase-order-draft-saved.png)

`PO-00000018` is a saved three-unit draft for Summit Steel Water Bottle at Demo Store. Its expected delivery date is October 23, 2026. Saving a draft records the order but leaves on-hand inventory unchanged.

![Purchase order draft editor before submission](screenshots/purchase-order-draft-form.png)

The editor lets an authorized user change supplier, destination, expected delivery, notes, and ordered quantities before submission. Submitting locks these details; stock changes only when a receipt is posted.

![Submitted purchase order ready for receiving, with no stock change](screenshots/purchase-order-submitted.png)

`PO-00000018` is submitted for three units. This confirmation makes it available for receiving but leaves on-hand stock unchanged. The receipt form appears farther down this page; record only the quantity physically received and include the supplier's delivery reference when available.

![Receipt form for a submitted order, with no units recorded](screenshots/purchase-order-receipt-form.png)

This form is ready to record a supplier delivery. The screenshot leaves **Received now** at zero and does not post a receipt; on-hand inventory changes only after the user enters the quantity received and records it.

![Purchase order register with one open and two total orders](screenshots/purchase-order-register.png)

The register can be filtered by order number or supplier, status, and destination. In this capture, `PO-00000018` is open at 0/3 units and `PO-00000007` is complete at 5/5 units. Use the order link to open details and follow receiving progress. Never include credentials or account email addresses in future captures.
