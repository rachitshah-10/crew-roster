# Shared team workspace

Updated 9 November 2026. This page supersedes the browser-isolation behavior in the earlier v1.4 handbook and historical verification reports.

The hosted demo has one scheduler role and one manager role operating on the same persistent D1 workspace. Browser cookies contain a random session token, not roster or result data. Each browser session stores its own role, CSRF token and expiry in `demo_sessions`; all uploaded rows, saved checks, rule versions and audit events use the shared team workspace.

## Workflow

1. Choose Scheduler on computer A, upload a fictional roster, preview and run the check.
2. Choose Manager on computer B and open or refresh Check history. The scheduler’s saved result is visible with its original rules and evidence.
3. A manager’s new rule version is visible to other sessions on their next request. New uploads capture it; older previews and checks keep their saved version.
4. Logging out or changing roles affects only that browser. Another computer keeps its session. A new private window joins the same shared data after role selection.

Schedulers can access scheduler-owned checks; managers can access all team checks, configure rules and read audit events. Role selection remains a public demonstration mechanism, not verified employee authentication.

## Existing records and rollout

The additive migration creates `demo_sessions` and its indexes. Existing tables, private workspaces, old results and rule snapshots are retained without modification. Old browser tokens ask the visitor to select a role again. Private workspace records are not automatically exposed to everyone with the public link; upload the intended fictional files again into the shared team. No old data is deleted.

The shared team seeds two fictional examples once. Initialization uses stable identifiers and an atomic batch to avoid duplicates during concurrent first visits. The former lifetime limits of 30 uploads and 100 policy versions no longer apply to the shared team. File-byte and serialized-record capacity safeguards remain.

## Operations

Apply only the new pending migration on existing local preview databases. Fresh databases need both migrations in order. Sites applies pending production migrations before deploying the Worker. Session expiry and logout do not delete team data. Retention/backup automation, company authentication and PostgreSQL remain future work.

There is no live-push subscription: refresh history or revisit the page to see another user’s new check. Stale rule edits return a conflict instead of overwriting a newer version.
