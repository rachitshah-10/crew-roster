# Crew Roster Compliance Checker

> **Team 5:** Rachit Shah (Lead), Shreyaa Lakshmivaragan, Jihyung Park  
> **Client:** Shubh Rakesh 
> **Course / Instructor:** Adam

A tool for airline crew schedulers and planning managers to validate crew duty schedules against duty length limits, mandatory minimum rest intervals, and certification validity before publication.

---

## Architecture Overview

1. **Local Service:** Lightweight, self-contained Python application using **FastAPI** and **SQLite** (`data/crewcheck.db`). Zero external cloud dependencies.
2. **Future Production Plan:** Migration to containerized backend and managed **PostgreSQL** cluster for high-scale enterprise rollouts.

For detailed request/response schemas and versioning guarantees, see [docs/api-contract.md](docs/api-contract.md).  
For contributor responsibility boundaries, see [docs/file-ownership.md](docs/file-ownership.md).

---

## Getting Started & Development Setup

### Prerequisites
* **Python:** 3.11 or newer (managed via `uv` or `venv`)
* **Node.js:** 22.13 or newer & `npm`

### 1. Environment Configuration
Review the reference environment file. The Python app reads exported environment variables; it does not load `.env` automatically:
```bash
cat .env.example
# Optional overrides, exported before first startup:
# export CREWCHECK_DB=data/my-demo.db
```

### 2. Python Dependencies (Local Engine & API)
Using `uv` (recommended):
```bash
uv sync --frozen
```

Or using standard `pip`:
```bash
python3 -m pip install -e .
```

To run the local development server after the backend, UI and documentation PRs are integrated:
```bash
./scripts/run.sh
```

### 3. Tests and Coverage
```bash
uv run pytest
uv run pytest --cov                        # terminal report with missing lines for app/
uv run pytest --cov --cov-report=html      # browsable report in htmlcov/
```
Coverage settings (source `app/`, branch coverage, minimum 96%) live in `pyproject.toml`; `--cov` fails below the minimum.

### 4. Node Dependencies (Diagram Tooling)
Install root tooling dependencies:
```bash
npm ci
```

---

## Running with Docker

```bash
docker compose up -d --build     # http://localhost:8000
docker compose logs -f           # follow logs
docker compose down              # stop (data is kept)
docker compose down -v           # stop and delete the data volume
```

The image runs the FastAPI app as a non-root user on port 8000 with a health check. The SQLite database and original uploaded files live in the `crewcheck-data` volume (`/data` in the container), so they survive rebuilds. Set `CREWCHECK_ALLOWED_HOSTS` to include your server's host name when it is not reached via `localhost`, change the demo passwords with `CREWCHECK_SCHEDULER_PASSWORD` / `CREWCHECK_MANAGER_PASSWORD`, and set `CREWCHECK_SECURE_COOKIE=1` only behind HTTPS.

## Database

SQLite is the default (`data/crewcheck.db`). To use PostgreSQL, set one variable; nothing else changes:

```bash
uv sync --extra postgres
export CREWCHECK_DATABASE_URL=postgresql+psycopg://crewcheck:secret@localhost:5432/crewcheck
./scripts/run.sh
# or, with Docker: docker compose -f compose.yaml -f compose.postgres.yaml up -d --build
```

- All SQL is in `app/repository.py` (SQLAlchemy Core); tables are in `app/schema.py`. The API layer never touches the database directly.
- Migrations (`app/migrations/`, Alembic) run automatically at startup. Existing SQLite files from earlier versions are adopted unchanged. Create a new migration with `CREWCHECK_DATABASE_URL=sqlite:///data/crewcheck.db uv run alembic revision -m "describe change"`.
- Original uploaded files go through `app/filestore.py`, so they can move to object storage by adding a backend with the same `put`/`get` methods.
- Run the whole test suite against PostgreSQL with `CREWCHECK_TEST_DATABASE_URL=postgresql+psycopg://user:pass@host:5432/postgres uv run pytest` (each test gets a fresh database).

## Ticket Ownership & Handoff

* **CRE-5 (Rachit Shah):** Initial project structure, locked dependencies, hosted infrastructure, and integration contracts.
* **CRE-6 (Shreyaa Lakshmivaragan):** Parsing, deterministic compliance engine, sample datasets, and engine tests.
* **CRE-7 (Rachit Shah):** Backend API, persistence, rule versioning, and SQLite integration.
* **CRE-8 (Jihyung Park):** Scheduler & manager UI workflows.
* **CRE-9 (Jihyung Park):** Handover documentation, architecture diagrams, user flow, and meeting demo runbook.

## Review documentation

The existing CrewCheck materials are available in this repository:

- [Project handbook PDF](docs/handbook/crewcheck-project-handbook.pdf) and [editable Word handbook](docs/handbook/crewcheck-project-handbook.docx)
- [Architecture and guide](docs/index.html)
- [Meeting demo runbook](docs/meeting-demo-runbook.html)
- [Local architecture](docs/architecture.md) and [user interactions](docs/user-flow.md)
- [PostgreSQL transition plan](docs/postgresql-plan.md)
- [Presentation sources and assets](presentation/)

The design, handbook and presentation baseline was reused from the [pinned reference](https://github.com/jihyungparkcoforge/crewcheck/tree/cc3850ccf3d2903052ce52098e0b3f3f4639fe9b).

The remaining backend work was completed by Jihyung at the project owner's request. CRE-7, CRE-8 and CRE-9 were delivered in separate PRs. Their initial combined checkout was verified with 27 Python tests, 14 hosted tests, TypeScript checks, a production build and real Chrome workflows. See [integration verification](docs/integration-verification.md) for scope, evidence and limitations. Shared-workspace changes have their own [verification record](docs/shared-workspace-verification.md).

## Running locally

The local FastAPI application runs at `http://127.0.0.1:8000` using `./scripts/run.sh`. Select a demo account and then Sign in. Changing thresholds creates a new policy version; old previews and saved results keep their own policy.

On a saved check, switch **Table** to **Timeline** to see each crew member as a row on a UTC calendar. Duty bars are coloured by finding status, insufficient rest and overlaps are hatched, and day headers show the finding count. Select a bar to open its evidence.

Managers build rules in **Rules & thresholds** from plain-language parts (who, which duties, what is measured, over which period, and the limit), starting from templates such as weekly hours, consecutive days, night duty or rest after night duty. **Preview** applies a draft to a saved check before anything is saved; saving creates a new rule version for future uploads.

Times are shown in your browser's time zone; switch it with the clock selector in the top bar. **Import log** lists every upload attempt, including rejected files with their errors, and lets you download the original file.

For a clean local rehearsal, use a new SQLite path. Confirm the current thresholds before the demo. No historical database needs to be deleted.

See the implemented [API contract](docs/api-contract.md), [file ownership](docs/file-ownership.md), [meeting runbook](docs/meeting-demo-runbook.html), and [speaker notes](docs/speaker-notes.md). PostgreSQL, company authentication and production operations remain future work.
