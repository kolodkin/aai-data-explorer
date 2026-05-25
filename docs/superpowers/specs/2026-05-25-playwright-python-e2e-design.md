# Python Playwright e2e via `uv`

## Goal

Replace the TypeScript Playwright e2e suite with a Python (`pytest-playwright`)
suite, driven by a `test` dependency group in `pyproject.toml` and run through
`uv run`. Consolidate e2e onto the backend's existing Python + `uv` toolchain.
Preserve the published HTML report deployed to the `artifact-view` gh-pages repo.

## Background

The repo currently has:

- `e2e/app.spec.ts` — one continuous Playwright test covering the full UI flow.
- `playwright.config.ts` — chromium project, `--no-sandbox`, 1280×900 viewport,
  90s test timeout, 15s expect timeout, `trace: on`, screenshot on failure,
  `baseURL` from `BASE_URL` env (default `http://localhost:5173`).
- `package.json` — `@playwright/test` devDependency, `test:e2e` script.
- CI (`.github/workflows/ci.yml`) — two jobs: `test-e2e` (matrix shard `1/1`,
  blob report) and `merge-e2e-reports` (merge blob → HTML, deploy to gh-pages,
  post an "E2E Report" check with a link).

The backend is already Python (FastAPI + SQLModel) managed by `uv` via the root
`pyproject.toml`, which currently defines no dependency groups.

## Decisions

- **Replace**, not add alongside: delete the TS spec + config, remove the
  `@playwright/test` npm dependency.
- **Keep the published HTML report**: generate it with `pytest-html` and deploy
  to the same `artifact-view` gh-pages location; keep the "E2E Report" check.
- **Single test function**: the original is one continuous browser session that
  relies on the `qv_session` cookie surviving reloads (the reload-resume step).
  pytest-playwright gives each test a fresh context, so keep the flow as one
  test function rather than splitting it, to preserve that behavior.

## Components

### 1. `pyproject.toml` — `test` dependency group

```toml
[dependency-groups]
test = [
    "pytest>=8",
    "pytest-playwright>=0.7",   # pulls playwright + pytest-base-url
    "pytest-html>=4.1",         # static HTML report for gh-pages
]
```

Invocation: `uv run --group test pytest`. (`default-groups` is intentionally
NOT set, to avoid pulling test deps into every `uv run` such as the backend
start; the explicit `--group test` is the documented path.)

Add a minimal `[tool.pytest.ini_options]` so `pytest` discovers `e2e/`:

```toml
[tool.pytest.ini_options]
testpaths = ["e2e"]
```

### 2. `e2e/test_app.py` — ported flow

Faithful port of `app.spec.ts` using the sync `page` fixture:

- `EXPECT_CLICKHOUSE_OK = os.environ.get("EXPECT_CLICKHOUSE_OK") == "1"`.
- One `test_queryview_e2e(page)` function mirroring the original steps:
  1. Load `/` (`wait_until="networkidle"`), assert `h1` text `QueryView`.
  2. Fill `prompt-input` with `new clickhouse`, press Enter, assert
     `clickhouse-form` and the five field test-ids are visible.
  3. Click `ch-test`, assert `ch-result` visible and non-empty; when
     `EXPECT_CLICKHOUSE_OK`, assert `data-ok="true"` and text "Connected".
  4. `if not EXPECT_CLICKHOUSE_OK: return` (UI-only path).
  5. Click `ch-connect`, assert `db-picker` + `[data-db="default"]` visible.
  6. Click `[data-db="default"]`, assert `connection-status` contains
     `connected - default`.
  7. Reload `/`, assert resume; `connect clickhouse`, pick `system`, assert
     `connected - system`.
  8. Goto `/?connection=clickhouse`, pick `information_schema`, assert
     `connected - information_schema`.

Uses `page.get_by_test_id(...)` (default `data-testid` attribute matches) and
`expect(...)` from `playwright.sync_api`.

### 3. `e2e/conftest.py` — fixtures mirroring `playwright.config.ts`

- `browser_type_launch_args` override: add `args=["--no-sandbox"]`.
- `browser_context_args` override: `viewport={"width": 1280, "height": 900}`.
- Default expect timeout 15s via `expect.set_options(timeout=15_000)`.
- `base_url` fixture override returning `os.environ.get("BASE_URL",
  "http://localhost:5173")`, preserving the env-var workflow.

### 4. Delete `playwright.config.ts`.

### 5. `package.json` — remove `@playwright/test` devDependency and the
`test:e2e` script. Keep `concurrently` and all dev/build scripts (Node still
builds the frontend).

### 6. CI (`.github/workflows/ci.yml`)

Keep: ClickHouse service, Node setup, `uv sync --frozen`, `npm ci`,
`npm run build -w frontend`, backend start (serving the built SPA), backend
stop.

Change:
- Browser install: `uv run --frozen --group test playwright install --with-deps chromium`.
- Test run: `uv run --frozen --group test pytest e2e --tracing retain-on-failure
  --html=report/index.html --self-contained-html`, with env `BASE_URL=
  http://localhost:8000` and `EXPECT_CLICKHOUSE_OK=1`.
- Drop the matrix shard and the separate `merge-e2e-reports` job (single shard
  → nothing to merge).
- Deploy the `report/` directory to the same `artifact-view` gh-pages path
  (`peaceiris/actions-gh-pages`, `continue-on-error: true`) and keep the
  "E2E Report" check (`LouisBrunner/checks-action`) with the report URL.
- Upload the pytest-playwright trace output (`test-results/`) as a CI artifact.

### 7. Docs

Update README "End-to-end tests" section and any `docs/*.md` references to use
`uv run --group test pytest` instead of `npm run test:e2e`. Update the layout
note that calls `e2e/` "Playwright browser tests" to reflect Python/pytest.

## Out of scope

- Splitting the suite into multiple tests / parallel sharding.
- Adding backend unit tests (this group is e2e-only for now).
- Changing the app or its API.

## Success criteria

- `uv run --group test pytest e2e` passes locally against a running app
  (UI-only path without ClickHouse).
- CI runs the Python suite, publishes the HTML report to gh-pages, and the
  "E2E Report" check links to it.
- No remaining references to `@playwright/test` or `playwright.config.ts`.
