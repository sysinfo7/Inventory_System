# Changelog

Notable project changes are recorded here. Versions follow Semantic Versioning.

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
