<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project team

Read `docs/agents/TEAM.md` before delegated work. It defines the named roles, shared constraints, task handoffs, and cost policy. The lead coordinates workers directly. Worker names are roles, not separate GitHub identities. Do not create sidebar chats or additional agents unless the lead assigns that work within the user's authorization.

## Documentation maintenance

When changing database migrations, keys, fields, relationships, constraints, indexes, functions, triggers, role grants, or implementation status, update `docs/EMPLOYER_DATABASE_DESIGN.md` in the same change. Keep its ER diagram and descriptions aligned with the SQL source and state clearly what is implemented in the schema versus available in the application. Link the design document from relevant project documentation.
