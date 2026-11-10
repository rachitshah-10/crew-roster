import datetime
import hashlib
import json
import os
import secrets
import time
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, Depends, HTTPException, Request, UploadFile, File, Form, Response
from fastapi.responses import RedirectResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware
from pydantic import BaseModel, ConfigDict, Field
from typing import Literal
from .engine import check_roster
from .ruleset import RulePreview, RuleSetChange, catalog, normalize_ruleset
from .timeline import build_timeline
from .parsing import parse_roster, RosterError, MAX_BYTES
from .engine import DEFAULT_RULES
from .filestore import LocalFileStore
from .repository import Conflict, Repository
from .storage import now, verify_password, password_hash

ROOT = Path(__file__).resolve().parent.parent
COOKIE = "crewcheck_session"

class BodyLimit:
    """Bound total request bytes before multipart parsing, including chunked uploads."""
    def __init__(self, app): self.app = app
    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] not in ("POST", "PUT", "PATCH"):
            return await self.app(scope, receive, send)
        limit = MAX_BYTES + 1024 * 1024 if scope["path"] == "/api/uploads" else 64 * 1024
        chunks, total = [], 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect": return
            part = message.get("body", b""); total += len(part)
            if total > limit:
                return await JSONResponse({"detail": "Request is too large."}, 413)(scope, receive, send)
            chunks.append(part)
            if not message.get("more_body", False): break
        sent = False
        async def replay():
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": b"".join(chunks), "more_body": False}
            return await receive()
        await self.app(scope, replay, send)

class Login(BaseModel):
    email: str = Field(max_length=160)
    password: str = Field(min_length=1, max_length=200)

def database_url(db_path=None):
    """CREWCHECK_DATABASE_URL wins; otherwise a SQLite file (argument, CREWCHECK_DB or data/crewcheck.db)."""
    if os.getenv("CREWCHECK_DATABASE_URL"):
        return os.environ["CREWCHECK_DATABASE_URL"]
    path = Path(db_path or os.getenv("CREWCHECK_DB", ROOT / "data/crewcheck.db")).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{path}"


def create_app(db_path=None):
    app = FastAPI(docs_url=None, redoc_url=None, title="CrewCheck API", version="0.1.0", description="Synthetic-data MVP. Deterministic illustrative rules, not regulatory certification.")
    base = Path(db_path or os.getenv("CREWCHECK_DB", ROOT / "data/crewcheck.db"))
    repo = app.state.repo = Repository(database_url(db_path))
    files = app.state.files = LocalFileStore(os.getenv("CREWCHECK_FILES") or base.parent / "files")
    repo.migrate()
    repo.seed([{"id": "scheduler", "name": "Alex Morgan", "email": "scheduler@crewcheck.local", "role": "scheduler",
                "password": os.getenv("CREWCHECK_SCHEDULER_PASSWORD", "SchedulerDemo!2026")},
               {"id": "manager", "name": "Taylor Reed", "email": "manager@crewcheck.local", "role": "manager",
                "password": os.getenv("CREWCHECK_MANAGER_PASSWORD", "ManagerDemo!2026")}],
              normalize_ruleset(DEFAULT_RULES), now(), password_hash)
    dummy_password = password_hash("invalid-login-dummy")
    app.add_middleware(BodyLimit)
    hosts = [h.strip() for h in os.getenv("CREWCHECK_ALLOWED_HOSTS", "localhost,127.0.0.1,testserver").split(",") if h.strip()]
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=hosts)

    @app.middleware("http")
    async def browser_security(request, call_next):
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            origin = request.headers.get("origin")
            if origin and origin != str(request.base_url).rstrip("/"):
                return JSONResponse({"detail": "Cross-origin requests are not allowed."}, 403)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    def token_hash(token):
        return hashlib.sha256(token.encode()).hexdigest()

    def authenticated(request: Request):
        user = repo.session_user(token_hash(request.cookies.get(COOKIE, "")), time.time())
        if not user: raise HTTPException(401, "Please sign in.")
        if request.method not in ("GET", "HEAD", "OPTIONS") and not secrets.compare_digest(request.headers.get("X-CSRF-Token", ""), user["csrf"]):
            raise HTTPException(403, "Invalid CSRF token. Refresh and sign in again.")
        return user

    def manager(user=Depends(authenticated)):
        if user["role"] != "manager": raise HTTPException(403, "Manager access required.")
        return user

    def rule_view(row):
        return {"version": row["id"], "created_at": row["created_at"], "created_by": row["created_by"],
                "reason": row["reason"], **normalize_ruleset(json.loads(row["rules_json"]))}

    def visible(row, user):
        return row is not None and (user["role"] == "manager" or row["owner_id"] == user["id"])

    def accessible_upload(upload_id, user):
        row = repo.upload(upload_id)
        if not visible(row, user): raise HTTPException(404, "Upload not found.")
        return row

    def accessible_run(run_id, user):
        row = repo.run(run_id)
        if row is None: raise HTTPException(404, "Check not found.")
        if not visible(row, user): raise HTTPException(404, "Upload not found.")
        return row

    def accessible_import(import_id, user):
        row = repo.import_attempt(import_id)
        if not visible(row, user): raise HTTPException(404, "Import not found.")
        return row

    def run_view(row):
        policy = {"id": row["policy_id"], "created_at": row["policy_created_at"], "created_by": row["policy_created_by"],
                  "reason": row["policy_reason"], "rules_json": row["policy_rules_json"]}
        return {"id": row["id"], "created_at": row["created_at"], "filename": row["filename"], "owner": row["owner"],
                "import_id": row["import_id"], "file_hash": row["file_hash"], "rules": rule_view(policy), **json.loads(row["result_json"])}

    def import_view(row):
        return {"id": row["id"], "created_at": row["created_at"], "filename": row["filename"], "owner": row["owner"],
                "status": row["status"], "size": row["size"], "file_hash": row["file_hash"], "stored": bool(row["stored"]),
                "row_count": row["row_count"], "upload_id": row["upload_id"], "run_id": row["run_id"],
                "options": json.loads(row["options_json"]) if row["options_json"].startswith("{") else row["options_json"],
                "errors": json.loads(row["errors_json"]),
                "import_options": json.loads(row["import_options_json"]) if row["import_options_json"] else None}

    def attempt_record(attempt, user, status, errors=(), import_options=None, row_count=None):
        return {"id": attempt["id"], "owner_id": user["id"], "filename": attempt["filename"], "created_at": now(),
                "size": attempt["size"], "file_hash": attempt["file_hash"], "stored": int(attempt["file_hash"] is not None),
                "status": status, "upload_id": None, "row_count": row_count, "options_json": attempt["options"],
                "errors_json": json.dumps(list(errors)), "import_options_json": json.dumps(import_options) if import_options else None}

    @app.get("/api/health")
    def health(): return {"status": "ok", "mode": "local-demo"}

    @app.post("/api/auth/login")
    def login(body: Login, request: Request, response: Response):
        address = request.client.host if request.client else "local"
        clock = time.time()
        attempt = repo.login_attempt(address)
        if attempt and clock - attempt["window_start"] < 300 and attempt["count"] >= 10:
            raise HTTPException(429, "Too many attempts. Try again in five minutes.")
        user = repo.user_by_email(body.email.strip().lower())
        valid = verify_password(body.password, user["password_hash"] if user else dummy_password)
        if not user or not valid:
            repo.record_failed_login(address, clock, 300)
            raise HTTPException(401, "Email or password is incorrect.")
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
        repo.start_session(address, user["id"], token_hash(token), csrf, clock + 28800, clock, token_hash(request.cookies.get(COOKIE, "")))
        response.set_cookie(COOKIE, token, max_age=28800, httponly=True, samesite="strict", secure=os.getenv("CREWCHECK_SECURE_COOKIE") == "1")
        return {"id": user["id"], "name": user["name"], "email": user["email"], "role": user["role"], "csrf": csrf}

    @app.get("/api/auth/me")
    def me(user=Depends(authenticated)): return user

    @app.post("/api/auth/logout")
    def logout(request: Request, response: Response, user=Depends(authenticated)):
        repo.end_session(token_hash(request.cookies[COOKIE]))
        response.delete_cookie(COOKIE)
        return {"ok": True}

    @app.get("/api/rules")
    def rules(user=Depends(authenticated)):
        return rule_view(repo.latest_rule_version())

    @app.get("/api/rules/history")
    def rule_history(user=Depends(manager)):
        return [rule_view(r) for r in repo.rule_versions(100)]

    @app.get("/api/rules/catalog")
    def rule_catalog(user=Depends(authenticated)): return catalog()

    @app.post("/api/rules/preview")
    def preview_rules(body: RulePreview, user=Depends(manager)):
        """Dry run: apply a draft rule set to a saved check's roster without saving anything."""
        saved = json.loads(accessible_run(body.run_id, user)["result_json"])
        proposed = check_roster(saved["rows"], {"rules": [r.model_dump() for r in body.rules]})
        before = {(f["row_number"], f["code"]) for f in saved["flags"]}
        after = {(f["row_number"], f["code"]) for f in proposed["flags"]}
        counts = {}
        for flag in proposed["flags"]: counts[flag["code"]] = counts.get(flag["code"], 0) + 1
        return {"saved": saved["summary"], "proposed": proposed["summary"],
                "added": len(after - before), "removed": len(before - after),
                "by_rule": [{"code": r.code, "name": r.name, "enabled": r.enabled, "findings": counts.get(r.code, 0)} for r in body.rules],
                "evidence_missing": counts.get("CERT_MISSING", 0),
                "examples": [f for f in proposed["flags"] if (f["row_number"], f["code"]) not in before][:10]}

    @app.post("/api/rules")
    def save_rules(body: RuleSetChange, user=Depends(manager)):
        if not body.name.strip() or len(body.reason.strip()) < 5: raise HTTPException(422, "Supply a rule set name and change reason.")
        values = {"name": body.name.strip(), "rules": [r.model_dump() for r in body.rules]}
        try: return rule_view(repo.add_rule_version(body.expected_version, user["id"], body.reason.strip(), values, now()))
        except Conflict: raise HTTPException(409, "Rules changed in another session. Reload this page before saving.")

    @app.post("/api/uploads", status_code=201)
    async def upload(file: UploadFile = File(...), options: str = Form("{}"), user=Depends(authenticated)):
        content = await file.read(MAX_BYTES + 1)
        filename = (file.filename or "roster").replace("\\", "/").split("/")[-1][:180]
        await file.close()
        # Every attempt is logged and, within the size budget, its original bytes are kept.
        digest = None if len(content) > MAX_BYTES else files.put(content)
        attempt = {"id": secrets.token_hex(12), "filename": filename, "size": len(content), "file_hash": digest, "options": options[:4000]}
        try:
            settings = json.loads(options)
            if not isinstance(settings, dict) or not isinstance(settings.get("mapping", {}), dict): raise ValueError()
            if any(k in settings and not isinstance(settings[k], str) for k in ("worksheet", "timezone")): raise ValueError()
        except (ValueError, TypeError):
            repo.log_import(attempt_record(attempt, user, "rejected", errors=[{"row": 0, "message": "Invalid import settings."}]))
            return JSONResponse({"detail": "Invalid import settings.", "import_id": attempt["id"]}, 422)
        attempt["options"] = json.dumps(settings)
        try: rows = parse_roster(filename, content, settings)
        except RosterError as exc:
            repo.log_import(attempt_record(attempt, user, "needs_setup" if exc.import_options else "rejected", errors=exc.errors, import_options=exc.import_options))
            return JSONResponse({"detail": str(exc), "errors": exc.errors, "import_id": attempt["id"], **({"import_options":exc.import_options} if exc.import_options else {})}, 422)
        uid = secrets.token_hex(12)
        policy = repo.accept_upload({"id": uid, "owner_id": user["id"], "filename": filename, "file_hash": digest, "created_at": now(), "rows_json": json.dumps(rows)},
                                    attempt_record(attempt, user, "accepted", row_count=len(rows)))
        return {"id": uid, "import_id": attempt["id"], "filename": filename, "row_count": len(rows), "crew_count": len({r['crew_id'] for r in rows}),
                "preview": rows[:20], "rules": rule_view(policy), "preview_limit": 20, "import_settings": settings,
                "dst_adjusted_rows": sum(1 for r in rows if r.get("dst_adjustments"))}

    @app.post("/api/uploads/{upload_id}/check")
    def check(upload_id: str, user=Depends(authenticated)):
        uploaded = accessible_upload(upload_id, user)
        existing = repo.run_for_upload(upload_id)
        if existing: return run_view(existing)
        policy = repo.rule_version(uploaded["rule_version"])
        result = check_roster(json.loads(uploaded["rows_json"]), json.loads(policy["rules_json"]))
        return run_view(repo.add_run({"id": secrets.token_hex(12), "upload_id": upload_id, "created_at": now(), "result_json": json.dumps(result)}))

    @app.get("/api/runs")
    def list_runs(q: str = "", from_date: str = "", to_date: str = "", offset: int = 0, user=Depends(authenticated)):
        if offset < 0: raise HTTPException(422, "Offset must be positive.")
        if len(q) > 160: raise HTTPException(422, "Search is too long.")
        try: start, end = [datetime.date.fromisoformat(v) if v else None for v in (from_date, to_date)]
        except ValueError: raise HTTPException(422, "Use YYYY-MM-DD dates.")
        total, records = repo.runs(None if user["role"] == "manager" else user["id"], q, start, end, offset, 25)
        items = [{k: item[k] for k in ("id", "created_at", "filename", "owner", "summary", "rules")} for item in map(run_view, records)]
        return {"items": items, "total": total, "offset": offset, "limit": 25}

    @app.get("/api/runs/{run_id}")
    def get_run(run_id: str, user=Depends(authenticated)):
        return run_view(accessible_run(run_id, user))

    @app.get("/api/runs/{run_id}/timeline")
    def get_run_timeline(run_id: str, tz: str = "UTC", user=Depends(authenticated)):
        result = json.loads(accessible_run(run_id, user)["result_json"])
        try: return build_timeline(result, tz)
        except ValueError as exc: raise HTTPException(422, str(exc))

    @app.get("/api/imports")
    def list_imports(status: Literal["all", "accepted", "rejected", "needs_setup"] = "all", offset: int = 0, user=Depends(authenticated)):
        if offset < 0: raise HTTPException(422, "Offset must be positive.")
        total, rows = repo.imports(None if user["role"] == "manager" else user["id"], None if status == "all" else status, offset, 25)
        return {"items": [import_view(r) for r in rows], "total": total, "offset": offset, "limit": 25}

    @app.get("/api/imports/{import_id}")
    def get_import(import_id: str, user=Depends(authenticated)):
        return import_view(accessible_import(import_id, user))

    @app.get("/api/imports/{import_id}/file")
    def download_import(import_id: str, user=Depends(authenticated)):
        row = accessible_import(import_id, user)
        content = files.get(row["file_hash"]) if row["stored"] else None
        if content is None: raise HTTPException(404, "The original file was not stored for this import.")
        return Response(content, media_type="application/octet-stream",
                        headers={"Content-Disposition": f"attachment; filename*=utf-8''{quote(row['filename'])}"})

    @app.get("/api/templates/{kind}")
    def template(kind: Literal["csv", "xlsx"], user=Depends(authenticated)):
        return FileResponse(ROOT / "samples" / f"sample_roster.{kind}", filename=f"sample_roster.{kind}")

    @app.get("/")
    def index(): return FileResponse(ROOT / "app/static/index.html")

    @app.get("/documentation")
    def documentation(): return RedirectResponse("/project-docs/index.html")

    app.mount("/static", StaticFiles(directory=ROOT / "app/static", check_dir=False), name="static")
    app.mount("/samples", StaticFiles(directory=ROOT / "samples"), name="samples")
    app.mount("/project-docs", StaticFiles(directory=ROOT / "docs"), name="project-docs")
    return app
