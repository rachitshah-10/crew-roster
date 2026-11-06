import hashlib
import json
import os
import secrets
import time
from pathlib import Path

from fastapi import FastAPI, Depends, HTTPException, Request, UploadFile, File, Form, Response
from fastapi.responses import RedirectResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware
from pydantic import BaseModel, ConfigDict, Field
from typing import Literal
from .engine import check_roster
from .parsing import parse_roster, RosterError, MAX_BYTES
from .storage import connection, initialize, now, verify_password, password_hash

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

class RuleChange(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    expected_version: int
    name: str = Field(min_length=3, max_length=80)
    max_duty_hours: float = Field(ge=1, le=24)
    min_rest_hours: float = Field(ge=1, le=48)
    certification_at: Literal["start", "end"]
    reason: str = Field(min_length=5, max_length=400)


def create_app(db_path=None):
    app = FastAPI(docs_url=None, redoc_url=None, title="CrewCheck API", version="0.1.0", description="Synthetic-data MVP. Deterministic illustrative rules, not regulatory certification.")
    app.state.db_path = str(db_path or os.getenv("CREWCHECK_DB", ROOT / "data/crewcheck.db"))
    initialize(app.state.db_path)
    dummy_password = password_hash("invalid-login-dummy")
    app.add_middleware(BodyLimit)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "testserver"])

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

    def authenticated(request: Request):
        token = request.cookies.get(COOKIE, "")
        with connection(app.state.db_path) as db:
            row = db.execute("SELECT u.id,u.name,u.email,u.role,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=? AND expires>?",
                             (hashlib.sha256(token.encode()).hexdigest(), time.time())).fetchone()
        if not row: raise HTTPException(401, "Please sign in.")
        user = dict(row)
        if request.method not in ("GET", "HEAD", "OPTIONS") and not secrets.compare_digest(request.headers.get("X-CSRF-Token", ""), user["csrf"]):
            raise HTTPException(403, "Invalid CSRF token. Refresh and sign in again.")
        return user

    def manager(user=Depends(authenticated)):
        if user["role"] != "manager": raise HTTPException(403, "Manager access required.")
        return user

    def rule_view(row):
        return {"version": row["id"], "created_at": row["created_at"], "created_by": row["created_by"],
                "reason": row["reason"], **json.loads(row["rules_json"])}

    def upload_view(db, upload_id, user):
        row = db.execute("SELECT * FROM uploads WHERE id=?", (upload_id,)).fetchone()
        if not row or (user["role"] != "manager" and row["owner_id"] != user["id"]):
            raise HTTPException(404, "Upload not found.")
        return row

    def run_view(db, row):
        upload = db.execute("SELECT * FROM uploads WHERE id=?", (row["upload_id"],)).fetchone()
        policy = db.execute("SELECT * FROM rule_versions WHERE id=?", (upload["rule_version"],)).fetchone()
        owner = db.execute("SELECT name FROM users WHERE id=?", (upload["owner_id"],)).fetchone()[0]
        return {"id": row["id"], "created_at": row["created_at"], "filename": upload["filename"], "owner": owner,
                "file_hash": upload["file_hash"], "rules": rule_view(policy), **json.loads(row["result_json"])}

    @app.get("/api/health")
    def health(): return {"status": "ok", "mode": "local-demo"}

    @app.post("/api/auth/login")
    def login(body: Login, request: Request, response: Response):
        address = request.client.host if request.client else "local"
        clock = time.time()
        with connection(app.state.db_path) as db:
            attempt = db.execute("SELECT * FROM login_attempts WHERE address=?", (address,)).fetchone()
            if attempt and clock - attempt["window_start"] < 300 and attempt["count"] >= 10:
                raise HTTPException(429, "Too many attempts. Try again in five minutes.")
            user = db.execute("SELECT * FROM users WHERE email=?", (body.email.strip().lower(),)).fetchone()
            valid = verify_password(body.password, user["password_hash"] if user else dummy_password)
            if not user or not valid:
                if not attempt or clock-attempt["window_start"] >= 300:
                    db.execute("INSERT OR REPLACE INTO login_attempts VALUES (?,?,?)", (address, 1, clock))
                else: db.execute("UPDATE login_attempts SET count=count+1 WHERE address=?", (address,))
                # Commit attempts before returning an authentication error.
                db.commit()
                raise HTTPException(401, "Email or password is incorrect.")
            db.execute("DELETE FROM login_attempts WHERE address=?", (address,))
            db.execute("DELETE FROM sessions WHERE expires<=?", (clock,))
            previous = request.cookies.get(COOKIE, "")
            db.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(previous.encode()).hexdigest(),))
            token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
            db.execute("INSERT INTO sessions VALUES (?,?,?,?)", (hashlib.sha256(token.encode()).hexdigest(), user["id"], csrf, clock+28800))
        response.set_cookie(COOKIE, token, max_age=28800, httponly=True, samesite="strict", secure=os.getenv("CREWCHECK_SECURE_COOKIE") == "1")
        return {"id": user["id"], "name": user["name"], "email": user["email"], "role": user["role"], "csrf": csrf}

    @app.get("/api/auth/me")
    def me(user=Depends(authenticated)): return user

    @app.post("/api/auth/logout")
    def logout(request: Request, response: Response, user=Depends(authenticated)):
        with connection(app.state.db_path) as db:
            db.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(request.cookies[COOKIE].encode()).hexdigest(),))
        response.delete_cookie(COOKIE)
        return {"ok": True}

    @app.get("/api/rules")
    def rules(user=Depends(authenticated)):
        with connection(app.state.db_path) as db:
            return rule_view(db.execute("SELECT * FROM rule_versions ORDER BY id DESC LIMIT 1").fetchone())

    @app.get("/api/rules/history")
    def rule_history(user=Depends(manager)):
        with connection(app.state.db_path) as db:
            return [rule_view(r) for r in db.execute("SELECT * FROM rule_versions ORDER BY id DESC LIMIT 100")]

    @app.post("/api/rules")
    def save_rules(body: RuleChange, user=Depends(manager)):
        if not body.name.strip() or len(body.reason.strip()) < 5: raise HTTPException(422, "Supply a rule name and change reason.")
        with connection(app.state.db_path) as db:
            db.execute("BEGIN IMMEDIATE")
            current = db.execute("SELECT MAX(id) FROM rule_versions").fetchone()[0]
            if current != body.expected_version: raise HTTPException(409, "Rules changed in another session. Reload this page before saving.")
            values = body.model_dump(exclude={"expected_version", "reason"})
            values["name"] = values["name"].strip()
            cursor = db.execute("INSERT INTO rule_versions(created_at,created_by,reason,rules_json) VALUES (?,?,?,?)",
                                (now(), user["id"], body.reason.strip(), json.dumps(values)))
            return rule_view(db.execute("SELECT * FROM rule_versions WHERE id=?", (cursor.lastrowid,)).fetchone())

    @app.post("/api/uploads", status_code=201)
    async def upload(file: UploadFile = File(...), options: str = Form("{}"), user=Depends(authenticated)):
        content = await file.read(MAX_BYTES + 1)
        filename = (file.filename or "roster").replace("\\", "/").split("/")[-1][:180]
        await file.close()
        try:
            settings = json.loads(options)
            if not isinstance(settings, dict) or not isinstance(settings.get("mapping", {}), dict): raise ValueError()
            if any(k in settings and not isinstance(settings[k], str) for k in ("worksheet", "timezone")): raise ValueError()
        except (ValueError, TypeError): raise HTTPException(422, "Invalid import settings.")
        try: rows = parse_roster(filename, content, settings)
        except RosterError as exc:
            return JSONResponse({"detail": str(exc), "errors": exc.errors, **({"import_options":exc.import_options} if exc.import_options else {})}, 422)
        uid = secrets.token_hex(12)
        with connection(app.state.db_path) as db:
            db.execute("BEGIN IMMEDIATE")
            policy = db.execute("SELECT * FROM rule_versions ORDER BY id DESC LIMIT 1").fetchone()
            db.execute("INSERT INTO uploads VALUES (?,?,?,?,?,?,?)", (uid, user["id"], filename, hashlib.sha256(content).hexdigest(), now(), policy["id"], json.dumps(rows)))
        return {"id": uid, "filename": filename, "row_count": len(rows), "crew_count": len({r['crew_id'] for r in rows}),
                "preview": rows[:20], "rules": rule_view(policy), "preview_limit": 20, "import_settings": settings}

    @app.post("/api/uploads/{upload_id}/check")
    def check(upload_id: str, user=Depends(authenticated)):
        with connection(app.state.db_path) as db:
            db.execute("BEGIN IMMEDIATE")
            uploaded = upload_view(db, upload_id, user)
            existing = db.execute("SELECT * FROM runs WHERE upload_id=?", (upload_id,)).fetchone()
            if existing: return run_view(db, existing)
            policy = db.execute("SELECT rules_json FROM rule_versions WHERE id=?", (uploaded["rule_version"],)).fetchone()[0]
            result = check_roster(json.loads(uploaded["rows_json"]), json.loads(policy))
            run_id = secrets.token_hex(12)
            db.execute("INSERT INTO runs VALUES (?,?,?,?)", (run_id, upload_id, now(), json.dumps(result)))
            return run_view(db, db.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone())

    @app.get("/api/runs")
    def list_runs(q: str = "", from_date: str = "", to_date: str = "", offset: int = 0, user=Depends(authenticated)):
        clauses, args = [], []
        if offset < 0: raise HTTPException(422, "Offset must be positive.")
        if user["role"] != "manager": clauses.append("u.owner_id=?"); args.append(user["id"])
        if len(q) > 160: raise HTTPException(422, "Search is too long.")
        if q: clauses.append("u.filename LIKE ?"); args.append("%"+q+"%")
        for value, operator in [(from_date, ">="), (to_date, "<=")]:
            if value:
                import datetime
                try: datetime.date.fromisoformat(value)
                except ValueError: raise HTTPException(422, "Use YYYY-MM-DD dates.")
                clauses.append(f"substr(r.created_at,1,10) {operator} ?"); args.append(value)
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        with connection(app.state.db_path) as db:
            total = db.execute("SELECT COUNT(*) FROM runs r JOIN uploads u ON u.id=r.upload_id"+where, args).fetchone()[0]
            records = db.execute("SELECT r.* FROM runs r JOIN uploads u ON u.id=r.upload_id"+where+" ORDER BY r.created_at DESC,r.id DESC LIMIT 25 OFFSET ?", [*args, offset]).fetchall()
            items = []
            for row in records:
                item = run_view(db, row)
                items.append({k: item[k] for k in ("id", "created_at", "filename", "owner", "summary", "rules")})
        return {"items": items, "total": total, "offset": offset, "limit": 25}

    @app.get("/api/runs/{run_id}")
    def get_run(run_id: str, user=Depends(authenticated)):
        with connection(app.state.db_path) as db:
            row = db.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
            if not row: raise HTTPException(404, "Check not found.")
            upload_view(db, row["upload_id"], user)
            return run_view(db, row)

    @app.get("/api/templates/{kind}")
    def template(kind: Literal["csv", "xlsx"], user=Depends(authenticated)):
        return FileResponse(ROOT / "samples" / f"sample_roster.{kind}", filename=f"sample_roster.{kind}")

    @app.get("/")
    def index(): return FileResponse(ROOT / "app/static/index.html")

    @app.get("/documentation")
    def documentation(): return RedirectResponse("/project-docs/index.html")

    app.mount("/static", StaticFiles(directory=ROOT / "app/static"), name="static")
    app.mount("/project-docs", StaticFiles(directory=ROOT / "docs"), name="project-docs")
    return app
