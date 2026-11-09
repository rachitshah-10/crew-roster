# Development and operations

Unless a heading explicitly says hosted, this page describes the local FastAPI reference. Use sections 13–17 of the [project handbook](handbook/crewcheck-project-handbook.pdf) for separate local and hosted setup, current verification, operating limits and PostgreSQL rollout planning.

## Environment

Use Python 3.11+ and `uv`. `uv sync --frozen` installs exactly the dependencies in `uv.lock`; the project was verified with Python 3.13.3. Node is only needed for the optional JavaScript syntax check and Mermaid diagram regeneration. No JavaScript build, CDN, external font or API key is required.

Run `./scripts/run.sh`; it binds to 127.0.0.1:8000. Use `PORT=8001` to choose another port. `CREWCHECK_DB=/absolute/path/demo.db` selects a separate database. The default is `data/crewcheck.db`. Relative paths are relative to the launched process directory; the script changes to the project root.

Configuration reference is `.env.example`. Export values in the shell. The app does not automatically load an `.env` file. Seed passwords are read only when users are first created. The demo login buttons always fill the documented defaults, so enter overrides manually if configured.

## Commands

```sh
uv sync --frozen
uv run pytest -q
node --check app/static/app.js
uv run python -m scripts.create_samples
uv run python scripts/build_diagrams.py
```

The tests use temporary SQLite databases. They do not change demo history. Sample regeneration overwrites only the synthetic files in `samples/`. The Python diagram script rewrites only `docs/diagrams/system-architecture.svg`. The user flow is generated from `docs/diagrams/user-flow.mmd` using the pinned [Mermaid CLI](https://github.com/mermaid-js/mermaid-cli): run `npm ci --ignore-scripts` followed by `npm run diagrams:user-flow`. This requires Node 20+ and Chrome; the script detects Chrome on macOS or accepts `CHROME_PATH`. To use Puppeteer-managed Chrome instead, install it with `npx puppeteer browsers install chrome`. Generated SVGs are checked in, so normal app use needs neither Node nor Chrome.

## Test coverage

The suite checks CSV/XLSX equivalence, expected sample findings, timezone normalization, exact boundaries, overnight rest, first-duty coverage, missing/expired certification, nested overlap, imports above the former row limit, bad archives, formulas, multiple sheets, duplicate identities, unsupported formats, authentication/logout, server-side ownership, manager authorization, CSRF/origin, body limits, history filtering, version conflicts, immutable rule snapshots, run idempotence and restart persistence.

## Verification record

On 6 November 2026 the combined team branches passed 27 Python tests, 14 hosted tests, TypeScript checks and a production build. Real Chrome exercised local and hosted upload/review, errors, historical rules, keyboard behavior and a 390 px layout. See [integration verification](integration-verification.md) for reproducible commands, sample outcomes and current evidence. The copied handbook and presentation images retain their reference provenance.

## Database lifecycle

Tables are created on first start; two demo accounts and the initial rule version are seeded only when missing. Each request obtains its own connection with foreign keys enabled. SQLite uses WAL. Result snapshots and rule versions have no mutation/delete API. Immutability here is an application invariant, not cryptographic tamper-proof storage against a database administrator.

For a fresh isolated demo, use a **new database path** rather than deleting the old database:

```sh
CREWCHECK_DB=data/new-demo.db ./scripts/run.sh
```

For backups while live, use SQLite's backup API; do not copy only the main file while a WAL writer is active. Alternatively stop the app cleanly and back up the database and associated state. Backup/restore automation and retention policies are not implemented.

## Troubleshooting

- **Port in use:** select `PORT=8001`; do not kill unrelated processes.
- **Login rejected:** use the seeded credentials or the password override used at first database creation. Repeated failed attempts may throttle the IP for five minutes.
- **403 after a long-open page:** refresh and sign in again. Check the CSRF header and same-origin URL.
- **Cookie not retained over HTTP:** leave `CREWCHECK_SECURE_COOKIE=0` for local HTTP; enable it only with HTTPS.
- **Excel import setup:** select the roster worksheet, map different header names, and select the source zone for Excel dates. Formulas in the selected sheet need values.
- **Time zone error:** choose the actual source zone. For daylight-saving ambiguity, provide an explicit offset in the affected cell.
- **Historical result unchanged after configuration:** expected. A new upload preview is needed to capture a new rule version.
- **Missing history:** scheduler sees own records; manager sees all. Date filters refer to check creation time in UTC, not duty date.

## Before shared deployment

Choose and implement a production identity provider, remove demo credential affordances, configure allowed hosts and TLS, provision users, define tenancy and audit requirements, establish retention and backups, monitor failures, load-test realistic files and validate the approved regulation profile with stakeholders. Run schema migrations rather than relying on create-if-missing when evolving a deployed database.

## Hosted demo verification

The initial team integration results are recorded in [integration verification](integration-verification.md). Hosted browser checks used the production bundle with local D1 storage. They do not establish a new public deployment or production readiness.

## Documentation and sample sources

The architecture and role workflow diagram sources are in `docs/diagrams/`. The review deck sequences are in `presentation/user-flow.mmd`, `presentation/history-sequence.mmd` and `presentation/threshold-sequence.mmd`. The compact manager diagrams group the browser and backend under Application. Regenerate the starter roster pack with `uv run python -m scripts.create_demo_pack`.

## Configurable resource budgets

These settings protect the deployment and are not roster requirements. There is no hard-coded count of duties or physical rows. `CREWCHECK_MAX_UPLOAD_BYTES` controls the file-byte budget (current default 5 MiB); the request envelope allows a further 1 MiB. Set it in the local process environment or hosted runtime configuration, then validate memory use and representative files before increasing it.

The current XLSX reader bounds archive entries at 1,000 and declared expansion at 30 MiB, and reads up to 32 source columns. Normalized field values are bounded at 160 characters. The hosted snapshot model guards each normalized upload and result at 1.5 MB before saving. These remaining implementation budgets can require streaming, chunked storage or an internal-server deployment for larger workloads; removing the old row limit does not establish unlimited capacity. The previous 30-upload and 100-rule-version lifetime quotas no longer apply to the shared team.

Import requests may include JSON in multipart `options`: `worksheet`, `timezone` and `mapping` (canonical field to source header). A 422 response with `import_options` asks for missing interpretation choices and saves no upload. Successful previews return `import_settings`. Hosted audit entries retain the choices, and normalized rows retain the selected source sheet/time zone.
