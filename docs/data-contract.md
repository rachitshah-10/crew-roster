# Input contract and check semantics

## Import workflow

Upload UTF-8 CSV or Excel `.xlsx`. If the workbook has several worksheets, select the roster sheet. Other sheets are not checked. When column names differ, match them to the required fields in the upload screen. Additional columns are ignored. Column names must be unique.

The six fields needed for checking are crew ID, name, role, duty ID, duty start and duty end. The template names below are suggestions, not mandatory source header names. Certification expiry is optional. If absent or blank, the checker reports missing evidence rather than inferring validity.

| Field | Required value | Example / meaning |
|---|---|---|
| crew_id | Yes | `C001`; stable crew identifier within a file |
| crew_name | Yes | `Alex Sample`; display name |
| role | Yes | `pilot` or `cabin` |
| duty_id | Yes | `D101`; unique together with crew_id within the selected roster |
| duty_start | Yes | Excel date/time or `2026-11-09T06:00:00Z` |
| duty_end | Yes | Date/time strictly after start |
| certification_expires_at | Optional | An expiry instant; absent values produce missing-evidence findings |

## Date interpretation

Excel date/time cells and ISO-style text dates are supported. Text such as `2026-11-09 06:00` needs a source time zone. The upload screen asks for a named zone such as `America/New_York`, `UTC`, or a fixed offset such as `+09:00`. The system never assumes the browser's zone. Timestamps already containing an offset retain it. Values are normalized to UTC for comparison and display.

Named zones account for daylight-saving changes automatically. A local time inside a clock change is not rejected: a repeated time (clocks go back) or skipped time (clocks go forward) resolves to the stricter reading for checks, which is the earliest duty start, the latest duty end and the earliest certification expiry. Each such row records `dst_adjustments` (field, local value, zone, `repeated`/`skipped`, choice and resulting UTC instant), and the UI shows them. An explicit offset in the cell always wins. A date without a time in text is not interpreted as a duty start or end. Excel stores a date-only cell as midnight; users must confirm that this is the intended instant in the preview. This handling does not implement aviation acclimatization rules.

## Validation and deployment capacity

There is no fixed roster-row ceiling. Blank rows do not consume a duty allowance. The selected roster must validate before a check can run. Duplicate crew/duty keys, inconsistent crew identities, missing required values and invalid periods still require correction. Source row numbers refer to the original selected sheet or CSV record. Selected worksheet and time zone are retained with normalized rows.

Formulas in the selected worksheet must be replaced with values. PDF, DOCX and legacy `.xls` remain outside the agreed input scope. Encrypted, macro-enabled and unsupported archive structures are not processed. Additional descriptive columns are accepted but not used as compliance evidence.

Upload bytes, decompression and storage budgets are operational safeguards, not client requirements or business rules. The current synchronous hosting model still has finite capacity. See Development and operations for the active settings and how they are changed. Supported production volume must be agreed and measured against representative client files.

## Demo rules

| Code | Rule | Boundary behavior |
|---|---|---|
| DUTY_LIMIT | `(duty_end - duty_start) > max_duty_hours` | Equal to maximum passes this check |
| REST_MIN | `0 <= next_start - latest_prior_end < min_rest_hours` | Equal to minimum passes this check |
| DUTY_OVERLAP | `next_start < latest_prior_end` | Always flagged; no separate REST_MIN for the same gap |
| CERT_EXPIRED | `expiry < assessment_time` | Equality is accepted; default assessment is duty end |
| CERT_MISSING | Expiry is blank | Incomplete evidence, not an asserted expired certificate |

Default maximum duty = 12 hours, minimum rest = 10 hours, certification assessment = duty end. Manager configuration supports max duty 1–24 h, minimum rest 1–48 h, assessment at start/end, and a descriptive policy name. The UI offers quarter-hour steps; the API accepts finite numbers within those ranges. Thresholds apply equally to both roles. These values are not presented as aviation law.

Duty/rest calculations use seconds internally and compare without rounding. Display text may be rounded; decisions are not based on that rounded text. Duties are sorted by start for each crew. The latest ending prior duty is used, including nested overlaps. The first duty's preceding rest is not assessed. Historical files are separate snapshots, not prior-duty context.

The certification field represents one supplied expiry instant, not a certificate registry. It does not verify required license type, aircraft qualification, recurrent training or revocation. Valid-at-end vs valid-at-start is an explicit configurable demo choice.

## Storage and reproducibility

Each accepted upload stores normalized rows and a reference to an immutable rule version. A rule version holds a named list of manager-built rules (see the API contract for the format); every rule is evaluated by the same engine from fixed building blocks, and nothing a manager enters is executed as code. The server stores the source SHA-256 and keeps the original file bytes in a content-addressed store (`CREWCHECK_FILES`, default `data/files/<hash[:2]>/<hash>`). Every upload attempt, accepted, rejected or waiting for import setup, is written to `import_attempts` with its filename, size, hash, status, import settings and errors. Files over the upload budget are logged without their bytes. Results store rows, findings, summary counts, coverage notes and `ENGINE_VERSION`. The same input and policy produce the same findings. Repeated check requests for an upload return its existing run ID. Uploading a file again creates a new preview and potentially a new comparison run.

A finding carries the source row, crew ID, duty ID, rule code, observed value, expected value, evidence timestamps/previous duty reference and review/incomplete classification. It does not automatically mark a schedule safe or unsafe.
