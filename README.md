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

* **CRE-5 (Rachit Shah):** Initial project structure, locked dependencies, hosted infrastructure, and integration contracts. *(This PR)*
* **CRE-6 (Shreyaa Lakshmivaragan):** Parsing, deterministic compliance engine, sample datasets, and engine tests.
* **CRE-7 (Rachit Shah):** Backend API, persistence, rule versioning, and SQLite integration.
* **CRE-8 (Jihyung Park):** Scheduler & manager UI workflows.
* **CRE-9 (Jihyung Park):** Handover documentation, architecture diagrams, user flow, and meeting demo runbook *(Jihyung assumes full README ownership in CRE-9)*.
