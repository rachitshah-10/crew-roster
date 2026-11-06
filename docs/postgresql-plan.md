# Storage and internal deployment plan

## What is implemented now

| Environment | Application | Storage | Identity |
|---|---|---|---|
| Local reference MVP | FastAPI / Python | SQLite file | Local demo accounts |
| Public review demo | Cloudflare Worker / JavaScript | Cloudflare D1, based on SQLite | Isolated browser workspace with selectable demo roles |
| Planned internal deployment | Internal application server | PostgreSQL | Company authentication and assigned roles |

PostgreSQL migration is **planned, not implemented or deployed**. The review demo uses a hosting-compatible backend; the local Python reference remains available. Golden synthetic fixtures verify that both deterministic checkers produce the same findings. Cloudflare-specific D1 access stays in the hosted API module, outside the pure checker.

## Audit evidence

The hosted demo persists upload records, original file hashes, result snapshots, the rule version used, and append-only action events. Events contain an ID, workspace, actor role, action, target, timestamp and contextual details. Upload/check/configuration mutations and their audit entries are committed together. Repeating a check returns its original snapshot without duplicating the execution event.

Demo roles are not verified employee identities. Browser workspaces are isolated; manager access is limited to that visitor's workspace. Workspace access expires after seven days. This is an access lifetime, not a promise of automatic data erasure. Retention and deletion operations still need to be defined for internal use. Database administrators can alter storage; application append-only behavior is not tamper-proof audit storage.

## Planned PostgreSQL migration

1. Confirm the internal hosting environment, authentication provider, organization/team permissions and approved policy model.
2. Replace demo workspaces with authenticated organization/user membership. Map an immutable actor ID to each audit event; retain the display name as a snapshot only where required.
3. Implement a PostgreSQL persistence adapter for the existing upload, rules, runs and audit operations. Use schema migrations, foreign keys, unique constraints and transactions. Convert ISO timestamp text to `timestamptz`, structured snapshots to `jsonb`, and keep original file hashes.
4. Preserve stable record IDs and per-check rule references. Do not recalculate historical runs during migration. Use an optimistic version check or locked current-policy row when publishing rule changes.
5. Restrict the application role's audit-table permissions to insert/select, and define retention, archival, access logging, backups and tested recovery. Evaluate stronger tamper evidence if the client's audit policy requires it.
6. Re-run parity, role isolation, concurrency and migration reconciliation tests on PostgreSQL. Reconcile row counts, IDs, hashes and rule references; perform a backup/restore rehearsal and controlled cutover.

No live employee data is needed for the public demo. The final regulatory rules, cumulative duty windows, full qualification model and cross-roster revision policy remain unresolved product decisions.
