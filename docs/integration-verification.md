# Team integration verification

Verified 6 November 2026 against merged CRE-5/CRE-6 (`b306747`) plus the CRE-7 backend, CRE-8 interface and CRE-9 documentation branches. Verification used a temporary combined checkout; the PRs remain separate for peer review. No merge to main or deployment was performed.

## Automated checks

| Check | Result |
| --- | --- |
| `uv sync --frozen` and `uv run pytest -q` | 27 passed; one upstream Starlette/httpx deprecation warning |
| In `hosted/`: `node --test tests/*.test.mjs` | 14 passed |
| In `hosted/`: `npx tsc --noEmit` | Passed |
| In `hosted/`: `npm run build` | Passed; Vinext reports its static route-classification limitation |
| Both browser scripts: `node --check` | Passed |
| Mermaid CLI renders of local/hosted user sequences | Passed |

Python tests use isolated temporary databases. Hosted API tests use a transactional SQLite test adapter; the browser pass additionally exercised the built Cloudflare Worker with local D1. Browser checks used real Chrome through Playwright, 1440 × 1000 and 390 × 844 viewports. Actual file inputs submitted multipart uploads to each backend; no upload mocks or sample-button shortcuts were used.

The regression suites cover captured versions before check execution, unchanged saved results, repeat-check idempotency, stale rule conflicts, role restrictions, cross-workspace access, invalid inputs, request protection and restart persistence.

## Verified browser outcomes

The following passed in both the local FastAPI application and the hosted production bundle running locally:

| File or action | Observed outcome |
| --- | --- |
| `clean_roster.csv` | Valid preview, zero findings |
| `review_roster.xlsx` | Valid Excel preview, six findings |
| `01_multiple_violations.csv` | Two duties, one flagged duty, three findings; all three shown in evidence drawer |
| `02_missing_required.csv` | Rejected: row 2 lacks crew name, row 3 lacks duty start |
| `03_missing_certification.csv` | Accepted; one incomplete-evidence finding |
| `04_duplicate_records.csv` | Rejected: duplicate crew/duty identity on row 4 |
| `05_corrected_roster.csv` | Accepted, zero findings |
| `06_exact_boundaries.csv` | Accepted, zero findings at configured boundaries |
| Manager changes rules from v1 to v2 | New upload uses v2; old result is byte-for-byte unchanged as JSON and still displays v1 |
| History and Applied rule set card | Saved version, name, duty/rest limits and certification basis shown; expandable creator/time/reason visible |
| `multi-sheet-excel-dates.xlsx` | Choose Crew duties, map columns, confirm America/New_York; 06:00 source becomes 11:00 UTC; one duty, zero findings |
| `601-duties.csv` | All 601 duties accepted and checked |
| Keyboard evidence inspection | Enter opens Details; Tab remains in dialog; Escape closes and restores trigger focus |
| 390 px result view | No page-level horizontal overflow; wide data table scrolls within its container; evidence remains usable |

Hosted manager audit events were also verified after upload/check and role switching. Nested import choices now display readable values instead of `[object Object]`. No uncaught page errors occurred during the main workflow checks. This is focused browser verification, not a full accessibility audit or production load test.

## Evidence

- [Hosted findings](verification/hosted/multiple-findings.png), [evidence drawer](verification/hosted/evidence-details.png), [duplicate validation](verification/hosted/duplicate-validation.png).
- [Historical policy in history](verification/hosted/historical-policy.png), [old result after rule update](verification/hosted/saved-rule-version.png).
- [Import preview](verification/hosted/import-preview.png), [audit events](verification/hosted/audit-events.png), [mobile result](verification/hosted/mobile-result.png).
- [Local browser results](verification/local/results.json), [hosted browser results](verification/hosted/results.json), [local import results](verification/local/imports.json), [hosted import results](verification/hosted/imports.json).

Start from a fresh local database or a fresh hosted browser workspace when reproducing baseline counts. The default policy is maximum duty 12 hours, minimum rest 10 hours, certification valid through duty end. Follow the [meeting runbook](meeting-demo-runbook.html) and [README setup](../README.md).

## Changes found during integration

- Restored hosted runtime modules excluded by the initial Python `lib/` ignore pattern; explicitly allow authored `hosted/lib` source.
- Allow backend API startup before the UI branch is integrated; the UI route becomes available when CRE-8 is present.
- Corrected the proposed API field examples to the actual reference-based contract; no engine algorithm or database schema was redesigned.
- Added local access to fictional sample files linked from the guide.
- Render nested import settings in the manager audit table.
- Replace the guide's old flowchart with explicit-human-actor sequence diagrams; preserve the existing presentation sequences.

## Remaining boundaries

The production build and browser checks were local; the target repository has not been published. Public links in the copied handbook/presentation refer to the separate reference demo. Those existing PDF/DOCX artifacts and historical screenshots were retained, not regenerated or claimed as new target-build evidence.

Thresholds are illustrative and apply equally to pilot/cabin roles. The approved rulebook, cumulative limits, prior-roster context, revision policy and qualification data source still need business decisions. PostgreSQL, employee SSO, operational retention/backup/restore and tenant administration are future work. Local history stores checks and rule versions but has no general audit-event endpoint; hosted audit actors are demo roles. Technical byte/storage/workspace budgets are documented in the API contract and are not stakeholder roster requirements.
