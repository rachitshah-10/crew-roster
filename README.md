# Crew Roster Compliance Checker

> **Team 5:** Rachit Shah (Lead), Shreyaa Lakshmivaragan, Jihyung Park  
> **Client:** Shubh Rakesh 
> **Course / Instructor:** Adam

A tool for airline crew schedulers and planning managers to validate crew duty schedules against duty length limits, mandatory minimum rest intervals, and certification validity before publication.

---

## Architecture Overview

The system supports two deployment targets with identical compliance semantics:
1. **Local Reference Service:** Lightweight, self-contained Python application using **FastAPI** and **SQLite** (`data/crewcheck.db`). Zero external cloud dependencies.
2. **Hosted Web Demo:** Built with **Next.js 16 / Vinext**, React, Tailwind CSS, and **Cloudflare D1** (SQLite-based), running in a Cloudflare Worker runtime.
3. **Future Production Plan:** Migration to containerized backend and managed **PostgreSQL** cluster for high-scale enterprise rollouts.

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

### 3. Node Dependencies (Hosted Frontend & Tooling)
Install root tooling dependencies:
```bash
npm ci
```

Install hosted web application dependencies:
```bash
cd hosted
npm ci
cd ..
```

---

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

The design, handbook and presentation baseline was reused from the [pinned reference](https://github.com/jihyungparkcoforge/crewcheck/tree/cc3850ccf3d2903052ce52098e0b3f3f4639fe9b). The [public demo](https://crewcheck-roster-demo.swoonypopcorn.chatgpt.site/) is maintained from this repository’s hosted implementation.

The remaining backend work was completed by Jihyung at the project owner's request. CRE-7, CRE-8 and CRE-9 were delivered in separate PRs. Their initial combined checkout was verified with 27 Python tests, 14 hosted tests, TypeScript checks, a production build and real Chrome workflows. See [integration verification](docs/integration-verification.md) for scope, evidence and limitations. Shared-workspace changes have their own [verification record](docs/shared-workspace-verification.md).

## Hosted preview on your machine

From `hosted/`, with Node 22.13+:

```sh
npm ci
node --test tests/*.test.mjs
npx tsc --noEmit
npm run build
# Initialize only a new local database; do not replay against existing state.
npx wrangler d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_absurd_doctor_strange.sql
npx wrangler d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_dark_tony_stark.sql
npm run start -- --port 8789
```

Open `http://127.0.0.1:8789`. Select Scheduler in one browser and Manager in another to verify shared history. All commands above use local D1 state. These local commands do not publish the site or modify its production database.

The local FastAPI application runs at `http://127.0.0.1:8000` using `./scripts/run.sh`. Select a demo account and then Sign in. Changing thresholds creates a new policy version; old previews and saved results keep their own policy.

For a clean local rehearsal, use a new SQLite path. Hosted browsers share the same data; a private window no longer resets history or policy. Confirm the current thresholds before the demo. No historical database needs to be deleted.

See the implemented [API contract](docs/api-contract.md), [file ownership](docs/file-ownership.md), [meeting runbook](docs/meeting-demo-runbook.html), and [speaker notes](docs/speaker-notes.md). PostgreSQL, company authentication and production operations remain future work.

## Shared team history

The hosted demo now uses one shared team workspace. Browser cookies hold a session token, while D1 stores the shared records and policies. Scheduler uploads are visible to a Manager on another computer. Existing private workspace records are preserved but are not automatically published into the shared team; re-upload the intended fictional files to share them. See [shared workspace behavior](docs/shared-workspace.md). The copied v1.4 handbook and earlier verification screenshots describe the prior implementation.
