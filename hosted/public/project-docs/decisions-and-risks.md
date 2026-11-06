# Decisions and unresolved questions

## Feedback mapped to implementation

| Feedback | MVP decision / evidence |
|---|---|
| CSV | Supported with strict schema and UTF-8 parsing |
| Excel | `.xlsx`, selectable roster worksheet, Excel dates and column mapping |
| PDF or DOCX: no | Explicitly excluded in UI and API |
| Documentation from start to end | README, architecture, flows, contract, demo, operations and decisions |
| Present architecture before demo | Browser documentation landing page and demo script begin with architecture |
| Crew scheduler and planning manager | Two roles; owner-only scheduler history vs all-team manager history |
| Authentication? | Working local password/session login; production identity remains open |
| Proposed user workflow | Mermaid, SVG and step-by-step role flow |
| How scheduler uploads | Upload, strict validation, preview, explicit run |
| How violations are displayed | Per-duty findings, filters and evidence drawer |
| Manager historical flags | Searchable immutable check snapshots with original rule versions |
| Threshold configuration | Manager-only append-only versions with reason, author and time |
| Risks / unresolved questions | This document and documentation landing page |

## Decisions confirmed for this MVP

- Scheduler can upload and review own results. Manager can inspect all history and configure thresholds. Confirmed by the project owner on 5 November 2026.
- Only CSV and Excel input. PDF and DOCX are not an extension goal in this scope.
- Synthetic data only; no roster edits, crew removal or outbound messages.
- Local folder deliverable, no cloud publication.

## Explicit implementation assumptions

- Local password sessions demonstrate authentication. This is not a chosen production identity provider.
- Two seeded accounts illustrate roles; they do not answer “how many people will use it?”
- One organization, one rule profile applying to both crew roles.
- Source time zones are provided in timestamps or explicitly selected during import. UI displays UTC.
- One certification expiry field per duty; default validity assessed at duty end.
- Complete uploaded roster is a standalone snapshot. Prior uploads are not implicitly merged.
- All configured deviations are review findings; the checker cannot certify full legal compliance.
- SQLite is appropriate for a local demo. No capacity claim has been measured.

## Questions to resolve before production or a broader pilot

| Priority | Question | Why it matters |
|---|---|---|
| Required | Which jurisdiction, operation type and crew roles are in scope? | FAA/EASA and company policies differ; a generic maximum is insufficient |
| Required | Which approved rulebook and version is authoritative? | Precise limits, definitions, exceptions and auditability |
| Required | What do duty start/end represent? Are positioning, standby and post-flight tasks included? | The timestamps determine the calculation's meaning |
| Required | Where do qualifications and expiry data come from? Which certificates are required? | A single expiry is only a demonstration model |
| Required | How many actual users, organizations and concurrent uploads? | Provisioning, tenancy and deployment capacity |
| Required | Production authentication: company SSO, local accounts, MFA? Who provisions managers? | The current accounts are local demo identities |
| Required | Retention, privacy, deletion, backups and restore requirements? | Stored roster snapshots contain personnel information in real use |
| Scope | Are files complete rosters or incremental revisions? | Cross-file rest checks and duplicate/version semantics |
| Scope | Are roster notes an input? | Current schema intentionally rejects extra columns |
| Scope | Which cumulative limits and exception approvals must be supported? | Current engine only covers simple within-file checks |
| Scope | Are acknowledgement, ownership, remediation and export required? | Current results are read-only review evidence |

## Known technical and product limits

- No full aviation regulation implementation. FAA/EASA fatigue rules can depend on report time, sectors, augmented crews, acclimatization and cumulative limits. Those factors are not modeled.
- First-duty rest cannot be established without preceding records. File history does not fix this automatically.
- Manager changes preserve historical results, but no general audit log for every page view/login/export is implemented.
- Original source files are discarded after parsing. Digests and normalized rows support traceability, but byte-for-byte source retrieval is not available.
- Upload drafts persist even if a user leaves without running a check; no draft browser or cleanup job exists.
- Rule history UI lists the latest 100 versions; run history uses pagination.
- Checks run synchronously without a fixed row ceiling. Deployment resource budgets still apply. Production volume requires representative files and load testing.
- Default credentials, local HTTP, SQLite, basic IP throttle and missing recovery/provisioning are not a production deployment design.

## Reference material

The following sources informed the earlier regulatory discussion, not this engine's default thresholds:

- [ICAO fatigue management](https://www.icao.int/operational-safety/fatigue-management)
- [14 CFR Part 117](https://www.ecfr.gov/current/title-14/chapter-I/subchapter-G/part-117)
- [EASA Air Operations, ORO.FTL](https://www.easa.europa.eu/en/document-library/easy-access-rules/online-publications/easy-access-rules-air-operations?erules-id=ERULES-1963177438-11941)

Research was checked during the presentation work on 4 November 2026. Verify the applicable edition and approved operator policy before implementing a regulatory profile.

## Public review deployment

The hosted review demo uses SQLite-based D1 and isolated browser workspaces. Roles are selectable demo profiles, not employee identities. PostgreSQL migration, company authentication, retention/backup procedures and verified actor audit IDs are planned for an internal-server rollout, not implemented. See `postgresql-plan.md`.
