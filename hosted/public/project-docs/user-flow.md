# User workflow sequence

![User workflow sequence](diagrams/user-flow.svg)

## Entry

Choose Scheduler or Manager without account registration. All browsers join the same team workspace. Two fictional checks are seeded once for the team. Each browser has its own role session; switching roles or signing out does not change another browser’s session.

## Scheduler

Entry opens Load a roster so the full demonstration begins with an actual file upload. Download a starter CSV/XLSX, use Browse files, review the preview, and Run roster check.

Open own saved checks, upload CSV/XLSX, correct reported input errors, preview rows and the captured rule version, run the deterministic checks, filter results and inspect evidence. Active thresholds can be read but not edited.

## Manager

All scheduler actions plus shared team history, rule-version history, threshold changes with a reason, and audit events. A manager on another computer can open the scheduler’s saved checks.

## Human follow-up

The app flags evidence. It does not change schedules, remove crew, contact employees or make staffing decisions. Human review and correction happen outside this MVP.

## Production difference

Demo role selection is not employee authentication. Internal deployment is planned to use company sign-in, assigned roles, PostgreSQL storage and an agreed audit retention policy.
