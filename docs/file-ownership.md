# Project File Ownership & Ticket Responsibilities

> **Team 5:** Crew Roster Compliance Checker  
> **Team Lead:** Rachit Shah  
> **Contributors:** Rachit Shah, Shreyaa Lakshmivaragan, Jihyung Park

---

## 1. Ownership Principles

1. **Single Owner Per File:** Every file in this repository is explicitly assigned to one contributor to prevent merge conflicts and maintain accountability.
2. **Feature Isolation:** Tickets are implemented on independent feature branches named `feature/<ticket-id>-<short-description>`.
3. **No Unilateral Changes:** Changes to files owned by another contributor must be coordinated and reviewed before merging.
4. **Clean PR Boundaries:** PRs must only touch files within the ticket scope. Unrelated refactoring or cross-cutting changes are prohibited.

---

## 2. File Ownership Matrix

| Contributor | Linear Ticket(s) | Focus Area | Explicitly Owned Files & Directories |
| :--- | :--- | :--- | :--- |
| **Rachit Shah** | [CRE-5](https://linear.app/crew-roster/issue/CRE-5/initialize-project-structure-and-integration-contracts)<br>[CRE-7](https://linear.app/crew-roster/issue/CRE-7/implement-backend-persistence-and-versioned-rule-history) | Project setup, core backend, storage, API, and hosted runtime infrastructure | • Root config: `.gitignore`, `.env.example`, `pyproject.toml`, `uv.lock`, `package.json`, `package-lock.json`<br>• App skeleton: `app/__init__.py`, `data/.gitkeep`, `scripts/run.sh`<br>• Backend: `app/main.py`, `app/storage.py`, `tests/test_api.py`<br>• Hosted infra & API: `hosted/package.json`, `hosted/package-lock.json`, `hosted/.gitignore`, `hosted/tsconfig.json`, `hosted/next.config.ts`, `hosted/postcss.config.mjs`, `hosted/eslint.config.mjs`, `hosted/cloudflare-env.d.ts`, `hosted/vite.config.ts`, `hosted/components.json`, `hosted/scripts/**`, `hosted/worker/**`, `hosted/vendor/**`, `hosted/components/**`, `hosted/hooks/**`, `hosted/examples/**`, `hosted/lib/utils.ts`, `hosted/lib/connectors.ts`, `hosted/lib/connector-*.ts*`, `hosted/lib/api.mjs`, `hosted/app/api/**`, `hosted/db/**`, `hosted/drizzle/**`, `hosted/drizzle.config.ts`, `hosted/tests/api.test.mjs`<br>• Integration docs: `docs/api-contract.md`, `docs/file-ownership.md` |
| **Shreyaa Lakshmivaragan** | [CRE-6](https://linear.app/crew-roster/issue/CRE-6/implement-roster-import-and-deterministic-compliance-checks) | Parsing, deterministic compliance engine, sample datasets, engine tests | • Local engine: `app/engine.py`, `app/parsing.py`, `tests/test_core.py`<br>• Hosted engine: `hosted/lib/checker.mjs`, `hosted/lib/parse-upload.mjs`, `hosted/lib/demo-fixtures.json`<br>• Hosted engine tests: `hosted/tests/checker.test.mjs`, `hosted/tests/import-options.test.mjs`<br>• Synthetic samples & scripts: `samples/**`, `hosted/public/samples/**`, `scripts/create_samples.py`, `scripts/create_demo_pack.py` |
| **Jihyung Park** | [CRE-8](https://linear.app/crew-roster/issue/CRE-8/implement-scheduler-and-manager-workflows)<br>[CRE-9](https://linear.app/crew-roster/issue/CRE-9/prepare-architecture-documentation-and-meeting-demo) | Frontend UI, user workflows, system documentation, architecture diagrams, demo runbook | • Local UI: `app/static/**`<br>• Hosted UI: `hosted/app/page.tsx`, `hosted/app/layout.tsx`, `hosted/app/globals.css`, `hosted/app/documentation/route.ts`, `hosted/public/static/**`, `hosted/public/favicon.svg`<br>• Project documentation: `README.md` *(takes ownership after CRE-5 setup)*, `docs/**` *(excluding `api-contract.md` and `file-ownership.md`)*, `hosted/public/project-docs/**`<br>• Diagram tooling & presentation: `presentation/**`, `scripts/build_diagrams.py`, `scripts/render_user_flow.mjs`, `scripts/build_handbook.py` |

---

## 3. Pull Request & Review Protocol

1. **Branch Naming:** `feature/cre-5-project-setup`, `feature/cre-6-engine-checks`, `feature/cre-7-backend-persistence`, `feature/cre-8-user-workflows`, `feature/cre-9-documentation-demo`.
2. **PR Description:** Must reference the Linear issue (e.g., `Closes CRE-5` or link `https://linear.app/crew-roster/issue/CRE-5/...`) and summarize changes.
3. **Peer Review:** Every PR requires at least one approving review from a teammate before merging into `main`.
4. **No Secrets / Build Artifacts:** Never commit `.env` secrets, runtime SQLite databases (`data/*.db`), temporary outputs, or `node_modules/`.

