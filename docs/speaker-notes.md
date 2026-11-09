# Jihyung's meeting speaker notes

## Architecture and workflow

“The scheduler uploads a CSV or Excel roster, confirms any import choices, reviews a preview, and runs the checks. The backend validates and normalizes the data, applies deterministic rules, and saves the result with its policy version. No LLM is needed for these comparisons.”

“For this review, the hosted application runs as a Cloudflare Worker with persistent D1 storage. The separate local application uses FastAPI and SQLite. PostgreSQL and company authentication are planned for internal deployment.”

## Interface decisions

“I kept upload, review and history as separate steps so users can inspect the source before creating a saved check. Invalid input stops at upload with row-specific messages. Missing certification is different: the check can run, but it reports incomplete evidence.”

“A duty can have several findings. The summary separates duties flagged from finding count. Details shows observed versus expected values and the source timestamps so the scheduler can understand the reason and decide what to do next.”

## History and rule changes

“The Applied rule set card belongs to this saved check. It shows the version, name, duty and rest limits, certification basis and creation details. The history table also shows the saved policy. Neither view substitutes today's active rules.”

“Watch what happens when I create v2: the existing result stays on v1 with the same findings, while a new upload captures v2. Even an uploaded preview keeps its original version if the manager changes settings before Run.”

## Demonstration order

1. Show architecture and the human-actor sequence before opening the app.
2. Upload `05_corrected_roster.csv`; preview and run: zero findings.
3. Upload `01_multiple_violations.csv`; open EDGE-D02: three findings on one duty.
4. Show missing required fields and duplicates, then corrected re-upload. Contrast missing certification with rejected input.
5. Use `review_roster.xlsx` for Excel support; use the flexible-import workbook if time permits.
6. Open Manager in a second browser or computer. Open history and audit events, create a rule version, and reopen the original result.
7. Close with current limitations and the business decisions still needed.

## Limits to state clearly

“These defaults demonstrate the workflow; they are not a complete aviation rulebook. First-duty rest cannot be assessed without preceding duties in the uploaded file, and historical uploads are not combined. The tool flags issues but does not edit schedules or track remediation.”

“Hosted role selection is for a fictional-data demo. It is not employee authentication. The scheduler and manager share the same saved history and rules across computers. Each browser keeps its own role session.”
