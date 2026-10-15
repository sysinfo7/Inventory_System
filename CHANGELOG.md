# Changelog

## [Unreleased]

### Documentation

- Add employer-manual screenshots and instructions for a saved purchase-order draft and its editable form.

## [1.6.1] - 2026-10-14

### Security

- Bound sign-in, password-change, and administrator password-reset form bodies to 16 KiB. Streamed oversized posts are rejected before authentication, and unsupported form content types are not parsed.

### Changed

- Show purchase-order line details as responsive cards at tablet widths so all product fields remain visible without horizontal scrolling.

### Testing

- Pass the CI-only receipt race test on [main commit 6f6abc6](https://github.com/sysinfo7/Inventory_System/actions/runs/38654409673): two sessions contend on one order and only one over-receipt attempt commits.
- Extend the local auth verifier to reject streamed sign-in bodies over 16 KiB and unsupported form content types before authentication.
- Pass GitHub Actions quality checks for [commit e4780fa](https://github.com/sysinfo7/Inventory_System/actions/runs/38660367771). Browser verification at a 697 px viewport confirms the purchase-order line items fit without horizontal overflow.

## [1.6.0] - 2026-10-14

### Added

- Add a supplier directory with normalized names, role-controlled edits, administrator-only soft deactivation, and retained purchasing history.
- Add quantity-only purchase orders with searchable supplier/product selectors, draft editing, submitted snapshots, destination tracking, and explicit submission/cancellation confirmation.
- Receive all or part of an open purchase order into the selected location in the same transaction as stock movements, receipt records, status updates, and audit events.
- Protect purchase receipt retries with exact request matching and reject over-receipts, inactive products, cross-order lines, and unauthorized actors.
- Add the `purchasing:verify` rollback-only workflow check to CI and document the schema, permissions, transaction, operational steps, and manual walkthrough.

### Scope

- Purchasing tracks physical quantities only. Supplier costs, currency, invoices, taxes, payments, and accounting entries are not included.
- Migrations 019–021, the local database check, stock/purchasing/authentication verifiers, and live admin browser walkthrough passed locally. The walkthrough completed PO-00000007 for five units in two receipts and confirmed both activity events and the updated location balance. GitHub Actions passed every check, including production build, purchasing verifier, concurrent receipt test, and authentication/permission smoke test, for [main commit 6f6abc6](https://github.com/sysinfo7/Inventory_System/actions/runs/38654409673) and [release tag v1.6.0](https://github.com/sysinfo7/Inventory_System/actions/runs/38652134590). A completed-order detail screenshot is now in the user manual; list, draft, and receipt-form screenshots remain future work.

Notable project changes are recorded here. Versions follow Semantic Versioning.

## [1.5.0] - 2026-10-14

### Added

- Let administrators set a matching temporary password for another active account; new accounts and generated permission-test accounts must replace temporary credentials before protected inventory access.
- Record `admin_password_reset` events with the account subject and initiating administrator where available, then revoke all sessions in the same database transaction.
- Lock account rows during login verification and session creation so a password reset cannot be bypassed by an in-flight login using the old password.
- Verify administrator-only access, same-origin checks, forced-change gating, session revocation, audit actors, and a concurrent login/reset in the disposable CI database.
- Update the account-management guidance, password-reset workflow, and schema documentation.

## [1.4.0] - 2026-10-14

### Added

- Allow signed-in users to change their password after confirming their current password.
- Revoke every active session when a password changes and record an append-only security event with no password or hash data.
- Verify same-origin enforcement, password confirmation, database-backed attempt limiting, stale-session rejection, session revocation, security-event grants, and new-password sign-in in the CI-only disposable database.
- Document account security in the user manual and database design.

## [1.3.2] - 2026-10-14

### Security and maintenance

- Update Next.js and `eslint-config-next` to the signed `16.4.1` patch release.
- Verify that the production dependency tree has no npm audit advisories. The full development tree still includes the unpatched `braces@3.0.3` advisory through the ESLint plugin; see `docs/SECURITY.md`.

## [1.3.1] - 2026-10-13

### Fixed

- Keep the CI-only stock movement's temporary actor in GitHub's disposable database so immutable audit history does not block verifier cleanup. Local auth verification still removes its temporary account.

## [1.3.0] - 2026-10-13

### Added

- Filter inventory movement history by recorded-by user (including legacy unattributed entries) and inclusive UTC date range.
- Add time-ordered database indexes for global and actor-filtered activity queries.

## [1.2.1] - 2026-10-13

### Fixed

- Make all seven movement fields fit in the mobile activity record, including the signed quantity and recorded-by actor.

### Documentation

- Add narrow-screen stock-entry and successful receipt screenshots to the user manual.
- Document the one-unit local demo receipt shown in the screenshots; clean database setup still seeds the original eight sample movements.

## [1.2.0] - 2026-10-13

### Security

- Revoke all active sessions when an administrator changes an account role or deactivates the account.
- Enforce session revocation in PostgreSQL for every account-update path.
- Restrict the trigger owner to deleting sessions by user ID; it cannot read session tokens or expiration data.
- Extend authentication verification to prove role changes and deactivation invalidate old sessions, including after account reactivation.

## [1.1.0] - 2026-10-13

### Added

- Add PostgreSQL-backed sign-in throttling: eight attempts per 15 minutes for an email/client pair and 100 per 15 minutes per client.
- Store HMAC digests instead of raw emails or IP addresses and delete expired throttle buckets in bounded batches.
- Extend auth verification to check rate-limit behavior and confirm the runtime DB role cannot read the backing table.
- Update the user manual to describe the implemented return, adjustment, user-management, and sign-in protection workflows.

### Security notes

- By default, local requests share a local client bucket. A deployment behind a trusted proxy may set `AUTH_TRUST_PROXY_HEADERS=true` only when that proxy replaces or sanitizes `X-Forwarded-For`.
- This is temporary throttling, not a persistent account lockout. Password recovery and production abuse monitoring remain future work.

## [1.0.1] - 2026-10-13

### Added

- Set global browser response headers to block framing and MIME sniffing, limit referrer details, disable unused browser permissions and DNS prefetch, and hide the Next.js framework banner.
- Extend the authentication smoke check to assert the security headers on the credential endpoint.
- Document the current v1.0.0 CI evidence and outstanding deployment limits.

### Security notes

- Content Security Policy, HSTS, login throttling, account recovery, and production TLS/network configuration remain future work. HSTS is not enabled on the local HTTP development server.

## [1.0.0] - 2026-10-13

### Added

- Initial feature-complete portfolio release with product catalog, multi-location inventory, receiving, returns, sale deductions, count adjustments, audit history, authentication, and role-based permissions.
- Database migrations, local setup and backup/restore procedures, employer-facing design documentation, and screenshots of the running application.
