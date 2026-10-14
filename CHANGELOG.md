# Changelog

Notable project changes are recorded here. Versions follow Semantic Versioning.

## [1.0.1] - 2026-10-14

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
