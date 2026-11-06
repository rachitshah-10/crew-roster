# API & Integration Contract: Crew Roster Compliance Checker

> **Status:** Baseline Contract (Established in [CRE-5](https://linear.app/crew-roster/issue/CRE-5/initialize-project-structure-and-integration-contracts))  
> **Applicability:** Shared integration contract for Local FastAPI and Hosted Next.js/Worker implementations.

---

## 1. System Architectures & Environments

This project maintains two deployment surfaces that adhere to this unified contract:

| Environment | Runtime & Stack | Persistence | Access Model |
| :--- | :--- | :--- | :--- |
| **Local Reference** | Python 3.11+ / FastAPI / Uvicorn | Local SQLite (`data/crewcheck.db`) | Local credentials (`SchedulerDemo!2026`, `ManagerDemo!2026`) with 8-hour sessions and CSRF protection. |
| **Hosted Web Demo** | Next.js 15 / Cloudflare Worker | SQLite-based Cloudflare D1 | Isolated visitor workspaces with demo role selector and append-only audit event logging. |
| **Future Production** | Scalable container service | PostgreSQL (Dedicated cluster) | Enterprise SSO / OIDC, RBAC, encrypted persistent audit storage. See PostgreSQL transition plan. |

---

## 2. Normalized Data Schemas

### 2.1 Roster Duty Record
Source files (CSV or `.xlsx`) are parsed and normalized into standard UTC duty records.

```json
{
  "crew_id": "C001",
  "crew_name": "Alex Sample",
  "role": "pilot",
  "duty_id": "D101",
  "duty_start": "2026-11-09T06:00:00Z",
  "duty_end": "2026-11-09T20:00:00Z",
  "certification_expires_at": "2026-12-01T00:00:00Z",
  "source_row": 2
}
```

* **Fields:**
  * `crew_id` (string, required): Stable crew identifier.
  * `crew_name` (string, required): Display name of crew member.
  * `role` (string, required): Either `"pilot"` or `"cabin"`.
  * `duty_id` (string, required): Unique identifier for the duty period.
  * `duty_start` (string, required): ISO-8601 UTC timestamp.
  * `duty_end` (string, required): ISO-8601 UTC timestamp strictly after `duty_start`.
  * `certification_expires_at` (string, optional): ISO-8601 UTC timestamp. If omitted or blank, reports `CERT_MISSING` incomplete evidence.
  * `source_row` (integer, required): 1-based row index in original file.

### 2.2 Finding Schema
Each flagged issue produces a structured finding:

```json
{
  "source_row": 2,
  "crew_id": "C001",
  "duty_id": "D101",
  "rule_code": "DUTY_LIMIT",
  "observed_value": "14.0h",
  "expected_value": "<= 12.0h",
  "evidence_timestamps": {
    "start": "2026-11-09T06:00:00Z",
    "end": "2026-11-09T20:00:00Z",
    "duration_seconds": 50400
  },
  "classification": "violation"
}
```

* **Standard Rule Codes:**
  * `DUTY_LIMIT`: Duty exceeds allowable hours (`duty_end - duty_start > max_duty_hours`).
  * `REST_MIN`: Insufficient rest between consecutive duties (`0 <= next_start - latest_prior_end < min_rest_hours`).
  * `DUTY_OVERLAP`: Overlapping duties for same crew (`next_start < latest_prior_end`).
  * `CERT_EXPIRED`: Certification expired before assessed instant (`expiry < assessment_instant`).
  * `CERT_MISSING`: Certification expiry is missing/blank (incomplete evidence).

---

## 3. Upload-Time Rule-Version Pinning

To guarantee audit integrity, rule evaluation follows strict version pinning:
1. **Rule Versioning:** Active rule configurations are immutable and versioned (`rule_version_id`).
2. **Upload Association:** When a roster is uploaded, the current active `rule_version_id` is stamped onto the upload record.
3. **Execution Guarantee:** Running a check evaluates against the **stamped rule version**, even if a manager modifies system rules after upload.
4. **Historical Immutability:** Historical check results (`runs`) store the exact findings, summary counts, and the rule version that applied. Reopening a historical run never recalculates results under current rules.
5. **Idempotency:** Requesting `/api/uploads/{id}/check` multiple times returns the existing `run_id` without re-running or duplicating data.

---

## 4. REST API Specification

### 4.1 Authentication & Identity

#### `POST /api/auth/login`
Authenticates user and issues session cookie.
* **Request:**
  ```json
  {
    "email": "scheduler@crewcheck.local",
    "password": "SchedulerDemo!2026"
  }
  ```
* **Response (200 OK):**
  ```json
  {
    "id": "u_scheduler",
    "email": "scheduler@crewcheck.local",
    "name": "Demo Scheduler",
    "role": "scheduler"
  }
  ```

#### `GET /api/auth/me`
Fetches current session identity and CSRF token.
* **Response (200 OK):**
  ```json
  {
    "user": {
      "id": "u_scheduler",
      "email": "scheduler@crewcheck.local",
      "name": "Demo Scheduler",
      "role": "scheduler"
    },
    "csrf_token": "a4f89d0e2c81..."
  }
  ```

---

### 4.2 Rules Management

#### `GET /api/rules`
Returns active rule configuration. Available to all signed-in users.
* **Response (200 OK):**
  ```json
  {
    "version": 1,
    "name": "Standard FAA Part 117 Baseline",
    "max_duty_hours": 12.0,
    "min_rest_hours": 10.0,
    "cert_assessment": "duty_end",
    "updated_at": "2026-11-06T12:00:00Z",
    "updated_by": "u_manager"
  }
  ```

#### `POST /api/rules`
Creates a new rule version. **Manager role required.**
* **Headers:** `X-CSRF-Token: <token>`
* **Request:**
  ```json
  {
    "name": "Winter Operations Buffer",
    "max_duty_hours": 11.5,
    "min_rest_hours": 11.0,
    "cert_assessment": "duty_end",
    "expected_version": 1,
    "reason": "Increased minimum rest buffer for winter conditions."
  }
  ```
* **Response (201 Created):**
  ```json
  {
    "version": 2,
    "name": "Winter Operations Buffer",
    "max_duty_hours": 11.5,
    "min_rest_hours": 11.0,
    "cert_assessment": "duty_end",
    "updated_at": "2026-11-06T15:30:00Z"
  }
  ```
* **Error (409 Conflict):** If `expected_version` does not match active version (stale update prevention).

---

### 4.3 Roster Upload & Checking

#### `POST /api/uploads`
Uploads a CSV or Excel file, parses records, validates structure, and pins the active rule version.
* **Content-Type:** `multipart/form-data`
* **Form Fields:**
  * `file`: (binary file)
  * `timezone`: `"UTC"`, `"America/New_York"`, or explicit offset (e.g., `"-05:00"`).
  * `sheet_name`: (optional for XLSX; defaults to first worksheet).
* **Response (201 Created):**
  ```json
  {
    "upload_id": "upl_01JCA...",
    "filename": "sample_roster.xlsx",
    "file_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "created_at": "2026-11-06T16:00:00Z",
    "rule_version_id": 1,
    "total_rows": 48,
    "preview_rows": [
      {
        "crew_id": "C001",
        "crew_name": "Alex Sample",
        "role": "pilot",
        "duty_id": "D101",
        "duty_start": "2026-11-09T06:00:00Z",
        "duty_end": "2026-11-09T20:00:00Z",
        "certification_expires_at": "2026-12-01T00:00:00Z",
        "source_row": 2
      }
    ]
  }
  ```
* **Error (422 Unprocessable Entity):** Invalidation on missing headers, corrupted data, or malformed timestamps.
  ```json
  {
    "error": "PARSING_FAILED",
    "message": "Row 14 contains duty_end before duty_start",
    "source_row": 14
  }
  ```

#### `POST /api/uploads/{id}/check`
Executes deterministic compliance rules against the uploaded records using the pinned rule version.
* **Response (200 OK):**
  ```json
  {
    "run_id": "run_01JCB...",
    "upload_id": "upl_01JCA...",
    "created_at": "2026-11-06T16:01:00Z",
    "rule_version_id": 1,
    "summary": {
      "total_duties_checked": 48,
      "flagged_duties": 4,
      "violations_count": 3,
      "incomplete_count": 1
    },
    "findings": [
      {
        "source_row": 2,
        "crew_id": "C001",
        "duty_id": "D101",
        "rule_code": "DUTY_LIMIT",
        "observed_value": "14.0h",
        "expected_value": "<= 12.0h",
        "classification": "violation"
      }
    ]
  }
  ```

---

### 4.4 History & Audit Records

#### `GET /api/runs`
Lists historical runs. Schedulers see own uploads; Managers see full team history.
* **Query Parameters:**
  * `q`: Substring search on filename.
  * `from_date`, `to_date`: Filter range in `YYYY-MM-DD`.
  * `offset`, `limit`: Pagination parameters (default 25 per page).
* **Response (200 OK):**
  ```json
  {
    "total": 12,
    "offset": 0,
    "limit": 25,
    "runs": [
      {
        "run_id": "run_01JCB...",
        "upload_id": "upl_01JCA...",
        "filename": "sample_roster.xlsx",
        "uploaded_by": "Demo Scheduler",
        "created_at": "2026-11-06T16:01:00Z",
        "rule_version_id": 1,
        "total_duties": 48,
        "flagged_duties": 4
      }
    ]
  }
  ```

#### `GET /api/runs/{id}`
Retrieves complete immutable check snapshot with all findings, evidence, and rule parameters.
* **Response (200 OK):** Returns full run object matching check result schema above.

---

## 5. Implementation Status & Tickets

| Module | Ticket | Owner | Status in CRE-5 |
| :--- | :--- | :--- | :--- |
| **Parsing & Rules Engine** | [CRE-6](https://linear.app/crew-roster/issue/CRE-6/implement-roster-import-and-deterministic-compliance-checks) | Shreyaa Lakshmivaragan | Contract defined; implementation deferred to CRE-6. |
| **Backend & Storage API** | [CRE-7](https://linear.app/crew-roster/issue/CRE-7/implement-backend-persistence-and-versioned-rule-history) | Rachit Shah | Contract defined; implementation deferred to CRE-7. |
| **Scheduler/Manager UI** | [CRE-8](https://linear.app/crew-roster/issue/CRE-8/implement-scheduler-and-manager-workflows) | Jihyung Park | Contract defined; implementation deferred to CRE-8. |
| **Docs & Presentation** | [CRE-9](https://linear.app/crew-roster/issue/CRE-9/prepare-architecture-documentation-and-meeting-demo) | Jihyung Park | Contract defined; handover scheduled for CRE-9. |

