# CrewCheck API and integration contract

This contract describes the CRE-6 parser/checker and CRE-7 backend used by the CRE-8 UI. It replaces the proposed CRE-5 field examples with the implemented payloads. The default 12-hour duty / 10-hour rest policy is illustrative; it is not a complete FAA or EASA regulation.

## Environments and access

| Surface | Runtime and storage | Identity |
| --- | --- | --- |
| Local | FastAPI, SQLite | Seeded scheduler/manager accounts; eight-hour cookie sessions |
| Hosted demo | Next.js 16 / Vinext, Cloudflare Worker, D1 | Shared team workspace with browser-specific role sessions; seven-day sessions |
| Planned internal deployment | Application server and PostgreSQL | Company identity and assigned permissions; not implemented |

All endpoints are same-origin. Authenticated POST requests require `X-CSRF-Token` from the identity response, except sign-in. Local manager access covers all local users; hosted manager access covers all records in the shared team workspace. Role selection in the hosted demo is not employee authentication.

## Identity

- `POST /api/auth/login`: local body `{ "email": "scheduler@crewcheck.local", "password": "SchedulerDemo!2026" }`; manager uses `manager@crewcheck.local` and `ManagerDemo!2026`. Configured environment passwords replace these local defaults.
- Hosted login body: `{ "role": "scheduler" }` or `{ "role": "manager" }`.
- Login and `GET /api/auth/me` return a **flat object** with `id`, `name`, `email`, `role`, `csrf`. Hosted identity also includes `mode: "shared-demo"` and session `expires_at`.
- `POST /api/auth/logout` returns `{ "ok": true }`. Hosted logout revokes only the current browser session and clears its cookie; shared records remain. Local logout ends that account session.

## Rules and historical guarantees

`GET /api/rules` returns the active policy. `GET /api/rules/history` is manager-only and returns an array of up to 100 versions, newest first.

```json
{
  "version": 2,
  "name": "Night operations",
  "created_at": "2026-11-10T12:00:00Z",
  "created_by": "manager",
  "reason": "Add a night duty limit",
  "rules": [
    {"code": "DUTY_LIMIT", "name": "Duty exceeds limit", "enabled": true, "role": "all", "when": [],
     "measure": "duty_hours", "per": "duty", "window_days": null, "compare": "<=", "limit": 12, "zone": "UTC", "at": "end"},
    {"code": "NIGHT_DUTY_LIMIT", "name": "Night duty limit", "enabled": true, "role": "pilot",
     "when": [{"field": "overlaps_time", "value": ["02:00", "05:59"]}],
     "measure": "duty_hours", "per": "duty", "window_days": null, "compare": "<=", "limit": 10, "zone": "Asia/Seoul", "at": "end"}
  ]
}
```

A rule reads as a sentence: *[role] · duties matching all `when` conditions · `measure` checked `per` must be `compare` `limit`*. A finding is raised when the comparison is false; its `code` is the rule's `code` and its `title` the rule's `name`. Rule versions saved in the original three-threshold format (`max_duty_hours`, `min_rest_hours`, `certification_at`) are converted on read, so historical checks remain readable.

`created_by` is the local user identifier (or setup identifier). Timestamp formatting can differ while representing the same UTC instant.

`GET /api/rules/catalog` (signed in) lists the building blocks: `measures` (label, unit, allowed `per`, `min`/`max` limit), `periods`, `conditions`, `roles`, `compare` and `presets`.

| `measure` | allowed `per` | unit |
|---|---|---|
| `duty_hours` | `duty`, `day` (clipped to local calendar days), `rolling_days` (window ending at each duty end, clipped) | h |
| `duty_count` | `day`, `rolling_days` | duties |
| `rest_hours` | `between_duties` (conditions select the duty *before* the rest; overlaps are ignored) | h |
| `overlap_hours` | `between_duties` | h |
| `consecutive_days` | `streak` (local calendar days with any duty) | days |
| `certification_remaining_hours` | `duty`, measured from duty `at` start/end; missing expiry yields `CERT_MISSING` (incomplete) | h |

Conditions (`when`, up to 5, combined with AND): `start_time`, `end_time`, `overlaps_time` (two `HH:MM` values; ranges may wrap midnight), `weekday` (0 = Monday … 6 = Sunday), `crew_id` (list). Times and days use the rule's `zone`. A duty gets at most one finding per rule code.

`POST /api/rules` is manager-only. Body: `name` (3–80), `reason` (5–400), `expected_version` and `rules` (1–30, unique `code` matching `^[A-Z][A-Z0-9_]{2,39}$`). Success is **200** with the new version; a stale version returns 409; invalid rules return 422 with `loc` pointing at the rule index and field.

`POST /api/rules/preview` is manager-only and saves nothing. Body: `run_id` and draft `rules`. Returns `saved` and `proposed` summaries, `added`/`removed` finding counts (by duty and code), `by_rule` counts, `evidence_missing` and up to 10 `examples` of new findings.

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

When choices are needed, 422 returns `detail`, `errors`, and `import_options` containing applicable `worksheets`, `headers`, `mapping`, `needs_mapping` or `needs_timezone` fields. Resubmit the same file with confirmed options. Explicit timestamp offsets are honored; naive timestamps/Excel dates require a confirmed source timezone. Times inside a DST change resolve automatically to the stricter reading and are listed in the row's `dst_adjustments`.

Success is **201**, with `id`, `filename`, `row_count`, `crew_count`, `preview` (first 20 normalized rows), `preview_limit`, captured `rules`, `import_settings`, `import_id` and `dst_adjusted_rows`. Rejected uploads (422) also return `import_id`. A normalized row includes the seven canonical fields plus `row_number`, with `source_sheet` and `source_timezone` provenance when applicable. Dates are normalized to UTC; missing certification is empty. The preview does not truncate the saved roster.

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
- `GET /api/runs/{id}/timeline`: per-crew timeline derived only from the saved rows and flags; never recalculates. Returns `start`/`end` (whole UTC days), `days` (`date`, `findings` counted by duty start day) and `crew` lanes sorted by findings then crew ID. Each lane has `crew_id`, `crew_name`, `role`, `findings`, `duties` (`row_number`, `duty_id`, `start`, `end`, `hours`, `codes`, `status`: `ok`/`review`/`incomplete`) and `gaps` (`kind`: `short_rest`/`overlap`, `start`, `end`, `previous_duty_id`, `duty_id`, `observed`). Same access rules as the run itself. Optional `?tz=<IANA zone>` (default `UTC`) sets day boundaries; each day has `date`, `start`, `end` (UTC instants), `hours` (23/25 on DST changes) and `findings`. Unknown zones return 422.
- `GET /api/imports?status=all|accepted|rejected|needs_setup&offset=0`: every upload attempt, newest first, 25 per page. Items have `id`, `created_at`, `filename`, `owner`, `status`, `size`, `file_hash`, `stored`, `row_count`, `upload_id`, `run_id`, `options`, `errors` and `import_options`. Schedulers see their own attempts; managers see all.
- `GET /api/imports/{id}`: one attempt. `GET /api/imports/{id}/file`: the original bytes as an attachment; 404 when not stored or not accessible.
- `GET /api/audit`: hosted manager-only, latest 100 workspace events as `items` containing `id`, `actor_role`, `action`, `target_id`, `created_at`, `details` (JSON string). Local implementation has check/rule history but no equivalent general audit endpoint.
- `GET /api/templates/csv` and `/xlsx`: local file response; hosted redirect to the static fictional sample.
- `GET /api/health`: health metadata (local mode or hosted database availability).

## Errors and capacity

Errors use `detail`; invalid roster rows also include `errors` with `row` and `message`. Local framework validation can return an array in `detail`; the UI supports both forms. Relevant statuses: 401 session required, 403 permission/CSRF/origin, 404 absent or inaccessible record, 409 stale rules, 413 request too large, 422 invalid input/import choices, 429 local sign-in throttle, and 500/503 hosted service errors.

`CREWCHECK_MAX_UPLOAD_BYTES` controls the upload byte budget (default 5 MiB); multipart overhead allows another 1 MiB. There is no fixed business row ceiling. Hosted storage currently bounds serialized uploads/results to 1.5 MB. The former lifetime quotas of 30 uploads and 100 rule versions were removed for the shared team workspace. These are demo resource safeguards, not stakeholder requirements. Retention cleanup, durable employee identity and production capacity are future work.
