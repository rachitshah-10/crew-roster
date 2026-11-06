# CrewCheck API and integration contract

This contract describes the CRE-6 parser/checker and CRE-7 backend used by the CRE-8 UI. It replaces the proposed CRE-5 field examples with the implemented payloads. The default 12-hour duty / 10-hour rest policy is illustrative; it is not a complete FAA or EASA regulation.

## Environments and access

| Surface | Runtime and storage | Identity |
| --- | --- | --- |
| Local | FastAPI, SQLite | Seeded scheduler/manager accounts; eight-hour cookie sessions |
| Hosted demo | Next.js 16 / Vinext, Cloudflare Worker, D1 | Browser workspace with selectable demo role; seven-day workspace access |
| Planned internal deployment | Application server and PostgreSQL | Company identity and assigned permissions; not implemented |

All endpoints are same-origin. Authenticated POST requests require `X-CSRF-Token` from the identity response, except sign-in. Local manager access covers all local users; hosted manager access covers only the same visitor workspace. Role selection in the hosted demo is not employee authentication.

## Identity

- `POST /api/auth/login`: local body `{ "email": "scheduler@crewcheck.local", "password": "SchedulerDemo!2026" }`; manager uses `manager@crewcheck.local` and `ManagerDemo!2026`. Configured environment passwords replace these local defaults.
- Hosted login body: `{ "role": "scheduler" }` or `{ "role": "manager" }`.
- Login and `GET /api/auth/me` return a **flat object** with `id`, `name`, `email`, `role`, `csrf`. Hosted identity also includes `mode` and `expires_at`.
- `POST /api/auth/logout` returns `{ "ok": true }`. Hosted logout leaves the workspace cookie available for selecting another demo role; local logout ends that account session.

## Rules and historical guarantees

`GET /api/rules` returns the active policy. `GET /api/rules/history` is manager-only and returns an array of up to 100 versions, newest first.

```json
{
  "version": 1,
  "name": "Illustrative MVP rules",
  "max_duty_hours": 12,
  "min_rest_hours": 10,
  "certification_at": "end",
  "created_at": "2026-11-06T12:00:00Z",
  "created_by": "Demo setup",
  "reason": "Initial illustrative policy"
}
```

`created_by` is the local user identifier (or setup identifier), or a hosted demo display name. Timestamp formatting can differ while representing the same UTC instant.

`POST /api/rules` is manager-only. Body: `name`, `max_duty_hours`, `min_rest_hours`, `certification_at` (`start` or `end`), `reason`, and `expected_version`. Success is **200** with the new policy. A stale version returns 409. Name length is 3–80 characters, reason 5–400, maximum duty 1–24 hours, minimum rest 1–48 hours. These are current configuration controls, not approved operational requirements.

Uploads capture a rule version when accepted. A later rule change does not change an existing preview, even before its first check. Saved checks retain their findings and applied rules. Repeating a check returns the same result ID. UI history and results must use each record's `rules` object, never substitute the active policy.

## Upload and import choices

`POST /api/uploads` accepts multipart `file` (CSV or XLSX) and an optional JSON string field `options`:

```json
{
  "worksheet": "Crew roster",
  "timezone": "America/New_York",
  "mapping": { "crew_id": "Employee ID", "crew_name": "Employee name" }
}
```

The mapping can cover all canonical input fields. Six core fields are required: `crew_id`, `crew_name`, `role`, `duty_id`, `duty_start`, `duty_end`. `certification_expires_at` is optional; missing evidence becomes `CERT_MISSING`. Roles are `pilot` or `cabin`. Duplicate `(crew_id, duty_id)` pairs within a file and invalid required values reject the import; no partial upload is saved. Extra columns are allowed.

When choices are needed, 422 returns `detail`, `errors`, and `import_options` containing applicable `worksheets`, `headers`, `mapping`, `needs_mapping` or `needs_timezone` fields. Resubmit the same file with confirmed options. Explicit timestamp offsets are honored; naive timestamps/Excel dates require a confirmed source timezone. Ambiguous or nonexistent DST times require correction.

Success is **201**, with `id`, `filename`, `row_count`, `crew_count`, `preview` (first 20 normalized rows), `preview_limit`, captured `rules`, and `import_settings`. A normalized row includes the seven canonical fields plus `row_number`, with `source_sheet` and `source_timezone` provenance when applicable. Dates are normalized to UTC; missing certification is empty. The preview does not truncate the saved roster.

## Check and results

`POST /api/uploads/{id}/check` returns **200** with:

- `id`, `created_at`, `filename`, `owner`, `file_hash` (SHA-256), `rules`, `engine_version`.
- `rows`: all normalized duties.
- `summary`: `duties`, `crew`, `flagged_duties`, `findings`, `no_flags`.
- `flags`: zero or more findings per duty.
- `coverage`: `first_duties_without_prior_rest` and a note explaining unassessed first-duty rest. Historical uploads are not merged for rest calculations.

Each flag has `id`, `row_number`, `crew_id`, `duty_id`, `code`, `title`, `observed`, `expected`, `evidence`, `severity`. Severity is `review` or `incomplete`. Evidence keys depend on the check and contain the underlying timestamps, prior duty identifier, or hours above a threshold.

| Code | Trigger |
| --- | --- |
| `DUTY_LIMIT` | Duty duration exceeds maximum |
| `REST_MIN` | Nonnegative rest is below minimum |
| `DUTY_OVERLAP` | Duty starts before the latest preceding duty ends |
| `CERT_EXPIRED` | Certification expires before the configured assessment instant |
| `CERT_MISSING` | Certification evidence not supplied; severity `incomplete` |

Equality at the duty/rest/expiry boundary passes. “No flags” only covers configured checks and available evidence.

## History, audit and samples

- `GET /api/runs?q=&from_date=&to_date=&offset=0`: `{ "items": [], "total": 0, "offset": 0, "limit": 25 }`. Each item contains `id`, `created_at`, `filename`, `owner`, `summary`, and full saved `rules`. Filename search and inclusive UTC `YYYY-MM-DD` date filters apply. Scheduler ownership is enforced server-side.
- `GET /api/runs/{id}`: full saved result; never recalculates. Inaccessible IDs return 404.
- `GET /api/audit`: hosted manager-only, latest 100 workspace events as `items` containing `id`, `actor_role`, `action`, `target_id`, `created_at`, `details` (JSON string). Local implementation has check/rule history but no equivalent general audit endpoint.
- `GET /api/templates/csv` and `/xlsx`: local file response; hosted redirect to the static fictional sample.
- `GET /api/health`: health metadata (local mode or hosted database availability).

## Errors and capacity

Errors use `detail`; invalid roster rows also include `errors` with `row` and `message`. Local framework validation can return an array in `detail`; the UI supports both forms. Relevant statuses: 401 session required, 403 permission/CSRF/origin, 404 absent or inaccessible record, 409 stale rules, 413 request too large, 422 invalid input/import choices, 429 local sign-in throttle, and 500/503 hosted service errors.

`CREWCHECK_MAX_UPLOAD_BYTES` controls the upload byte budget (default 5 MiB); multipart overhead allows another 1 MiB. There is no fixed business row ceiling. Hosted storage currently bounds serialized uploads/results to 1.5 MB, a workspace to 30 uploads (including two seeded examples), and policies to 100 versions. These are demo resource safeguards, not stakeholder requirements. Retention cleanup, durable employee identity and production capacity are future work.
