# syntax=docker/dockerfile:1
# CrewCheck: FastAPI app serving the API and the static UI from one process.

FROM python:3.13-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.6.14 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
# Dependencies first so code changes do not invalidate this layer.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --extra postgres --no-install-project
COPY app ./app
RUN uv sync --frozen --no-dev --extra postgres

FROM python:3.13-slim
RUN groupadd --system crewcheck && useradd --system --gid crewcheck --home /app crewcheck \
 && mkdir -p /data && chown crewcheck:crewcheck /data
WORKDIR /app
COPY --from=build /app/.venv /app/.venv
COPY app ./app
COPY samples ./samples
COPY docs ./docs
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    CREWCHECK_DB=/data/crewcheck.db \
    CREWCHECK_FILES=/data/files \
    CREWCHECK_ALLOWED_HOSTS=localhost,127.0.0.1 \
    PORT=8000
USER crewcheck
VOLUME ["/data"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import os,urllib.request;urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"PORT\"]}/api/health',timeout=2)"
CMD ["sh", "-c", "exec uvicorn app.main:create_app --factory --host 0.0.0.0 --port ${PORT} --proxy-headers"]
