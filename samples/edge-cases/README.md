# CrewCheck exception samples

All crew names, IDs and duties are fictional. Each scenario is supplied as CSV and as a single-sheet Excel workbook. Timestamps are text with explicit UTC offsets. Upload the individual files, not this folder or its ZIP archive.

Use maximum duty **12 hours**, minimum rest **10 hours**, and certification assessed through **duty end**. These are illustrative demo settings, not approved aviation limits.

| File stem | Expected result | What to show |
|---|---|---|
| `01_multiple_violations` | 2 duties, 1 flagged duty, 3 findings | EDGE-D02 has 14 h duty, 7 h rest, and expiry at 12:00 before its 17:00 end. All three findings appear in one Details drawer. |
| `02_missing_required` | Upload rejected | Row 2: crew_name is required. Row 3: duty_start is required. No check can be run. |
| `03_missing_certification` | 2 duties, 1 flagged duty, 1 finding | EDGE-D02 has CERT_MISSING. Missing evidence does not prove that the certificate has expired. |
| `04_duplicate_records` | Upload rejected | Row 4 repeats the same crew_id and duty_id from row 3. |
| `05_corrected_roster` | 2 duties, 0 findings | Two 8 h duties separated by exactly 10 h rest; valid certification. Use as the normal example and to recover from the invalid files. |
| `06_exact_boundaries` | 2 duties, 0 findings | Duty equals 12 h, rest equals 10 h and certification expiry equals duty end. Equality passes these configured rules. |

Suggested meeting order: **05 → 01 → 02 → 04 → 05 → 03 → Manager history**. Use 06 if asked about boundary conditions. The existing `../input_errors.csv` covers missing time zones and a zero-duration duty.

Every accepted case contains one crew member's first duty without earlier rest context. Zero findings means no issue found by the implemented checks, not complete regulatory compliance. Duplicate detection applies within one file. Re-uploading a file creates a new snapshot; it is not cross-file deduplication or a roster-edit workflow.

All 12 new files were uploaded through the public website and their displayed outcomes verified on 6 November 2026. Local parsing and rule checks also matched the manually specified expectations in `expected-results.json`.

See [meeting runbook](../../docs/meeting-demo-runbook.html) for timings, presenter wording, verification evidence and limitations. The new files are local meeting assets; they have not been added to the public site's Sample library.
