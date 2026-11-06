# Demo guide

For the Monday stakeholder meeting, use the [public web demo runbook](meeting-demo-runbook.html). It includes the verified normal, multiple-finding, missing-data, duplicate and recovery scenarios, plus the 30-minute agenda.

This script describes the local account-based reference. For the public web demo and actual file-picker upload walkthrough, use sections 5–8 and 15 of the [project handbook](handbook/crewcheck-project-handbook.pdf).

## 1. Present architecture before the app (2 minutes)

Open `/documentation` or `docs/index.html` and show the system architecture.

> The browser talks to one FastAPI application. The server validates CSV/Excel files, applies explicit deterministic rules, and saves evidence in SQLite. Authentication and permissions are enforced server-side. Each check retains its rule version, so historical findings remain reproducible after configuration changes.

Then show the user flow. Explain the two roles and that the tool flags issues for human review. No external system, LLM or production airline data is involved.

## 2. Scheduler upload (2 minutes)

1. Sign in using the **Scheduler** demo button, then **Sign in**.
2. Choose **Load roster**, then **Use sample roster**. Alternatively select `samples/sample_roster.csv` or `.xlsx` through Browse files.
3. Point out the six duties, four crew members, UTC-normalized preview and captured rule version. Only the first 20 rows are previewed for larger files; all rows are checked.
4. Choose **Run roster check**.

Under the initial 12 h / 10 h / valid-through-end policy:

| Duty | Expected finding | Evidence |
|---|---|---|
| D101, Alex Sample | Duty exceeds limit | 06:00–20:00 = 14 h, above 12 h |
| D103, Jordan Sample | Insufficient rest | D102 ends 23:00; D103 starts 06:00 next day = 7 h, below 10 h |
| D104, Morgan Sample | Certification expires too early | Expiry 12:00, duty ends 16:00 |

Expected: **6 duties, 4 crew, 3 flagged duties, 3 findings**. Four first duties lack preceding-rest context. Demonstrate this coverage message rather than implying they are all compliant.

## 3. How violations are displayed (1 minute)

Choose **Flagged**, search Jordan, and open **Details** for D103. Show the 7 h observed interval, 10 h minimum, two source timestamps, previous duty ID, rule version and source row. Clear the search and filter to another crew role. Explain that corrective scheduling happens outside this MVP.

## 4. Manager history (1 minute)

Sign out, fill Manager credentials, sign in. The scheduler's check appears in **Check history**. Search by filename or check date, open it, and show the unchanged evidence. Scheduler access remains restricted to own runs even if a different run ID is manually requested.

## 5. Configure thresholds and prove history is stable (2 minutes)

1. In **Rules & thresholds**, change max duty to **16 h**, min rest to **8 h**, certification assessment to **Duty start**.
2. Enter a reason such as `Demo comparison with revised illustrative thresholds` and save.
3. Return to the previous check. It still shows 3 findings and its original version.
4. Upload the same sample as a new preview. Run it under the new version. Only D103 remains flagged: 7 h is still below 8 h. D104's expiry covers its 08:00 start.
5. Restore 12 h / 10 h / duty end with another documented version if desired. Existing previews retain their captured version; upload afresh for a new policy comparison.

This is a demo of versioning, not a proposal to relax legal requirements.

## 6. Failure path and outstanding decisions (1 minute)

Upload `samples/invalid_roster.csv` to show a row-specific missing-timezone error. Mention that PDF/DOCX are excluded, and that no partial result is saved.

Close with unresolved items: actual regulatory scope, approved thresholds, certification data model, production authentication, real user count, retention, roster revision handling and cross-roster context. See `decisions-and-risks.md`.

## Before presenting

- Start the server and check `/api/health`.
- Confirm the active rules are the initial values if using the expected results above.
- Use only supplied synthetic files.
- Keep the architecture page ready before entering the app.
- Demo credentials are intentionally local/public. Do not deploy them unchanged.
