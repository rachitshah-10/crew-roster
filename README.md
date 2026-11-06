# CrewCheck

**Meeting documentation:** [Project handbook PDF](docs/handbook/crewcheck-project-handbook.pdf) · [Editable Word handbook](docs/handbook/crewcheck-project-handbook.docx). The handbook covers the public demo, local reference, user tasks, contracts, architecture, API, setup, verification, operations and planned internal rollout. It is the consolidated review baseline dated 5 November 2026.

**Public review demo:** [https://crewcheck-roster-demo.swoonypopcorn.chatgpt.site](https://crewcheck-roster-demo.swoonypopcorn.chatgpt.site)

Open the link and choose Scheduler or Manager; no registration is required. Each browser receives an isolated sample workspace. The hosted implementation is in `hosted/`; the FastAPI application below remains the local reference.

- [Architecture and user flow](https://crewcheck-roster-demo.swoonypopcorn.chatgpt.site/documentation)
- [Fictional CSV / Excel sample pack](https://crewcheck-roster-demo.swoonypopcorn.chatgpt.site/samples/README.html)
- [PostgreSQL internal rollout plan](docs/postgresql-plan.md)

The web demo stores records and audit events in SQLite-based Cloudflare D1. PostgreSQL is planned for the internal server; that migration is not implemented yet.

A working local MVP for reviewing synthetic crew rosters. Upload **CSV or Excel (.xlsx)**, review deterministic findings, revisit saved checks, and configure versioned demo thresholds. **PDF, DOCX, legacy .xls and macros are outside scope.**

## Applied rules in check history

Each upload pins its rule version. Check history shows that version, its name and duty/rest thresholds. Open a check to see the **Applied rule set** card with the saved thresholds and certification basis; expand **Rule version details** for the creator, creation time and reason. Later rule changes never recalculate or overwrite an existing check. Upload the roster again to assess it under a newer version.

## Start the local reference

Requires Python 3.11+ and [uv](https://docs.astral.sh/uv/).

```sh
git clone https://github.com/jihyungparkcoforge/crewcheck.git
cd crewcheck
./scripts/run.sh
```

Open **http://127.0.0.1:8000**. The script installs the locked dependencies and runs a local server. `PORT=8001 ./scripts/run.sh` selects another port. Stop with Ctrl+C.

Before showing the demo, open **http://127.0.0.1:8000/documentation** for the architecture and user flow. The [documentation page](docs/index.html) can also be opened directly as a file. OpenAPI schema: **http://127.0.0.1:8000/openapi.json**. A readable API overview is in `docs/architecture.md`.

### Local demo accounts

| Role | Email | Initial demo password | Access |
|---|---|---|---|
| Scheduler | scheduler@crewcheck.local | SchedulerDemo!2026 | Upload, check, view own records, read active rules |
| Manager | manager@crewcheck.local | ManagerDemo!2026 | Upload/check plus all team history and threshold changes |

The buttons on the login page fill these public demo credentials. These are two seeded **accounts**, not an estimate of real user count. The roles were confirmed by the project owner on 5 November 2026. Authentication provider, real users, scale and production deployment remain open decisions.

Accounts are seeded once into SQLite. Environment password overrides in `.env.example` apply only when those accounts are first created; changing an environment variable later does not rotate existing credentials. The app does not automatically load `.env` files. This MVP has no account provisioning, password reset or SSO integration.

## What to demonstrate

1. Present [system architecture](docs/diagrams/system-architecture.svg) and [user flow](docs/diagrams/user-flow.svg).
2. Sign in as Scheduler. Load the sample roster or choose a local CSV/XLSX file.
3. Review the preview and rule version, then run the check.
4. Review **6 duties, 4 crew, 3 findings affecting 3 duties** with the initial rules. Open the insufficient-rest evidence.
5. Sign in as Manager and open that scheduler's saved check in history.
6. Change a threshold with a reason, upload the same file again, and compare rule versions. The older result is preserved.
7. Review the outstanding decisions before calling this a production compliance tool.

See the full [demo guide](docs/demo-guide.md) for the script, expected results and failure path.

## Included

- Responsive, same-origin HTML/CSS/JavaScript UI with login, upload/preview, findings, evidence drawer, filtered history, role-aware navigation and rule configuration.
- FastAPI backend enforcing server-side ownership, manager permissions and CSRF protection.
- SQLite persistence for identities, sessions, parsed upload previews, immutable run results and rule versions.
- CSV/XLSX validation with row-level errors, explicit timezone offsets, file/row bounds and formula rejection.
- Deterministic checks: duty duration, rest between duties in the same file, overlapping duties, certification validity and missing expiry evidence.
- Synthetic CSV and XLSX samples and an invalid input example.
- Architecture and user flow diagrams in editable Mermaid and portable SVG, plus a browser-friendly documentation page.
- Automated parser, engine, security, API and persistence tests.

## Important product boundaries

These are **illustrative rules**, not a complete FAA, EASA or other jurisdiction's compliance implementation. Maximum duty defaults to 12 h, minimum rest to 10 h, and the supplied certification expiry must cover duty end. Both crew roles use the same demo policy. The policy can be edited by a manager.

A run is one self-contained roster snapshot. It does not merge past uploads or deduplicate revised rosters across files. Rest before a crew member's first duty cannot be assessed; the UI explicitly reports this coverage gap. “No flags” is not certification of compliance. A single expiry field is not a complete qualification model.

The app never modifies schedules, removes crew, contacts crew or uses an LLM. It only flags evidence for a human review. All demo data is synthetic.

## Project map

```text
app/main.py              HTTP API, sessions, permissions, static serving
app/parsing.py           CSV/XLSX validation and UTC normalization
app/engine.py            Pure deterministic checks
app/storage.py           SQLite schema and password hashing
app/static/              Browser UI, styles and JavaScript
samples/                 Synthetic CSV/XLSX and invalid CSV
scripts/run.sh           Start the local app
scripts/create_samples.py  Regenerate synthetic inputs
scripts/build_diagrams.py  Generate the architecture SVG
scripts/render_user_flow.mjs  Render the user flow from Mermaid
docs/                    Architecture, flows, contracts, risks and demo guide
tests/                   Automated test suite
uv.lock                  Reproducible dependency lock
data/                    Ignored runtime SQLite database
```

## Verify

```sh
uv sync --frozen
uv run pytest -q
node --check app/static/app.js
```

Node is optional at runtime; the last command is a development syntax check. Regenerate samples with `uv run python -m scripts.create_samples` and the architecture SVG with `uv run python scripts/build_diagrams.py`. Regenerate the user flow from Mermaid with `npm ci --ignore-scripts` then `npm run diagrams:user-flow` (Node 20+ and Chrome required; `CHROME_PATH` can select its executable).

## Documentation

- [Architecture, persistence and API](docs/architecture.md)
- [User flow and permissions](docs/user-flow.md)
- [Input contract and rule semantics](docs/data-contract.md)
- [Demo walkthrough](docs/demo-guide.md)
- [Decisions, risks and unanswered questions](docs/decisions-and-risks.md)
- [Development and operations](docs/development.md)

The app is bound to localhost by default. Deploying to shared infrastructure requires decisions on identity, TLS, secrets, account management, data retention and the actual regulatory policy.
