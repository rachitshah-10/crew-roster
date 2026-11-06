# Crew Roster Compliance Checker

> **Team 5:** Rachit Shah (Lead), Shreyaa Lakshmivaragan, Jihyung Park  
> **Client:** Shubh Rakesh (`Shubh.Nahar@coforge.com`)  
> **Course / Instructor:** Adam

A tool for airline crew schedulers and planning managers to validate crew duty schedules against duty length limits, mandatory minimum rest intervals, and certification validity before publication.

---

## Architecture Overview

The system supports two deployment targets with identical compliance semantics:
1. **Local Reference Service:** Lightweight, self-contained Python application using **FastAPI** and **SQLite** (`data/crewcheck.db`). Zero external cloud dependencies.
2. **Hosted Web Demo:** Built with **Next.js 15**, React, Tailwind CSS, and **Cloudflare D1** (SQLite-based), running in a Cloudflare Worker runtime.
3. **Future Production Plan:** Migration to containerized backend and managed **PostgreSQL** cluster for high-scale enterprise rollouts.

For detailed request/response schemas and versioning guarantees, see [docs/api-contract.md](docs/api-contract.md).  
For contributor responsibility boundaries, see [docs/file-ownership.md](docs/file-ownership.md).

---

## Getting Started & Development Setup

### Prerequisites
* **Python:** 3.11 or newer (managed via `uv` or `venv`)
* **Node.js:** 20.x or newer & `npm`

### 1. Environment Configuration
Copy the reference environment file:
```bash
cp .env.example .env
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

To run local development server (once backend is linked):
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

These materials were transferred from the [pinned reference implementation](https://github.com/jihyungparkcoforge/crewcheck/tree/cc3850ccf3d2903052ce52098e0b3f3f4639fe9b). Their screenshots, deployment links and recorded test outcomes describe that reference, not a newly verified team deployment. Final target verification depends on CRE-6, CRE-7 and CRE-8. Existing artifact-generation scripts retain their reference environment paths and need integration review before regeneration.

The [API contract](docs/api-contract.md) and [file ownership](docs/file-ownership.md) remain maintained by Rachit. The reference UI and the current contract use different field names in several places; reconcile those interfaces before an integrated demonstration.
