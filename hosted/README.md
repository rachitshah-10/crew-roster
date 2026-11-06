# CrewCheck hosted review demo

A public, sample-data-only web demo. Visitors choose Scheduler or Manager and receive an isolated browser workspace with two synthetic saved checks. The application includes CSV/XLSX upload and preview, deterministic findings, evidence, historical results, rule versioning, a sample library and an append-only audit view.

## Stack

Vinext / Cloudflare Worker; Cloudflare D1 (SQLite-based). UI assets are under `public/static/`. Pure checking and input validation live under `lib/`; D1 operations are contained in `lib/api.mjs`. The original local FastAPI + SQLite reference is in the parent project. Synthetic golden fixtures assert equivalent findings across the two engines.

**Internal-server PostgreSQL migration is planned, not implemented.** See `public/project-docs/postgresql-plan.md` for the staged transition and audit requirements.

## Local verification

Use Node 22.13+ (active LTS recommended), `npm ci`, `node --test tests/*.test.mjs`, `npx tsc --noEmit` and `npm run build`. Tests use temporary in-memory SQLite and do not alter hosted visitor records. Apply schema migrations to local D1 before `npm start` using the Sites instructions. Never manually replay an already-applied migration.

## Scope

Demo roles are selectable profiles, not verified employee identities. Workspace capability cookies expire after seven days; record erasure is not automated. Limits are 500 duties / 5 MiB per upload, 30 uploads per workspace including two seeded samples, and 100 rule versions. Only fictional data should be uploaded. Real regulations, SSO, roster revision handling, retention, backups and production capacity remain open work.

## Publication

Site identity is in `.openai/hosting.json`. Use the Sites source/publish helper with exact pushed source, schema migrations and generated build output. Do not commit runtime state, environment files, credentials, dependencies or local databases. Production schema changes are applied by Sites during deployment. The access policy is public by the project owner's instruction.
