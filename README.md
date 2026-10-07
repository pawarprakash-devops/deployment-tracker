# VidAI Deployment Tracker

Deployment tracking, release-governance and delivery-metrics dashboard for VidAI. Next.js 16 (App Router) + Neon Postgres + Tailwind 4, deployed to Vercel (`https://vidai-deployments.vercel.app`) by `.github/workflows/deploy.yaml` on every push to `main`.

> Next.js 16 has breaking changes vs. older versions — read `node_modules/next/dist/docs/` before changing framework-level code (see `AGENTS.md`).

## Pages

| Route | What it is |
|-------|-----------|
| `/` | Main dashboard: HUD counters, one card per environment (latest successful deploy, live health pill, QA release-window countdown), deployment history table, FE/BE compare modal, admin controls |
| `/admin` | Fleet telemetry: DORA suite (deployment frequency, lead time, change failure rate incl. prod-only CFR, MTTR), charts by environment/status, recent failures, longest runs, top operators, MTTR incident audit trail |
| `/` (promotion radar) | Above the environment cards: commits waiting to be promoted along dev→qa, qa→preprod, qa→demo, preprod→prod_neo and preprod→prod_ank for the backend or frontend repo, click a chip to list them (`/api/drift`). Counted from the last merged promotion PR; recomputed on page load and every 5 min while the tab is visible (no push/alerts) |
| `/jira` | Jira dashboard (admin login) with a **filter bar** — assignee, reported by, type, priority, status, label, component, fix version, created date range, text search, quick presets; filters apply to every section, are kept in the URL (shareable) and a **ticket explorer** with sort and CSV export: ticket metrics for `JIRA_PROJECT_KEYS` (open / in development / in QA, open bugs, created vs done, by workflow stage / status / assignee), the active sprint,  a **ready-to-ship queue** (tickets in QA Passed, flagged with where they've been deployed), **stuck tickets** (idle ≥ N days), **bug trends** (weekly created vs closed, by priority and age), **lead time** (created → done, created → first prod deploy), **release notes** per deployment (copyable markdown) and a **tickets-by-environment** matrix built from Jira keys found in deployment notes, branches, versions and ticket links |
| `/health` | Latest-successful-deploy view per environment (backed by `/api/health`) |

UI: dark theme by default with a light toggle (stored in `localStorage` key `tracker-theme`), VidAI brand palette. The page polls every **90 s, only while the tab is visible**, and refreshes immediately when the tab regains focus. API responses carry ETags and edge `Cache-Control` headers to stay under Neon/Vercel limits.

## Environments and ordering

Environments are rows in the `environments` table and are **auto-created by the webhook** on first sight. The UI orders cards by `PROMOTION_ORDER` in `app/page.tsx`:

`Preview (1)` → `Demo-Preview (1.5)` → `QA (2)` → `Stage / Stage EUW2 (3)` → `Pre-Prod (4)` → `Pre-Prod USW (5)` → `Production (Ankura) (6)` → `Production (Neotia/Babyjoy) (7)` → `Production (8)` → `LMS (9)`.

Branch → environment map used for compare: `dev`→Preview, `demo`→Demo-Preview, `qa`→QA, `stage`→Stage, `preprod`→Pre-Prod, `preprod_usw`→Pre-Prod USW, `prod_ank`→Production (Ankura), `prod_neo`→Production (Neotia/Babyjoy).

Environment name resolution (`normalizeEnvironment` in `app/api/webhook/route.ts`) matches, in order, against the raw environment + notes + branch names: `euw2` → Stage EUW2; `use1` → Stage USE1; `demo` / `preview-ecs-cluster` / `demo-preview` → **Demo-Preview** (checked *before* QA so PR titles like "QA to Demo" don't match QA); `preview` → Preview; `qa-aps` / `qa` (raw env only) → QA; pre-prod USW; pre-prod; `prod-ank`/`ankura`; `prod-neo`/`neotia`/`babyjoy`; `refera`; `prod`; `stage`; `lms`. Unknown names are cleaned (`-ecs-cluster` stripped) and registered as-is; an empty/`Other` environment falls back to **Demo-Preview**.

## Database

Neon Postgres (`DATABASE_URL`, pooled connection, SSL, pool max 20).

**environments** — `id` (UUID), `name` (unique), `is_production`, `display_order`, `created_at`, `updated_at`.

**deployments** — `id` (UUID), `environment`, `status`, `deployment_type` (`standard` | `rollback` | `hotfix`), `branch`, `version`, `frontend_branch`, `backend_branch`, `frontend_version`, `backend_version`, `requested_by`, `approved_by`, `tested_by`, `deployed_by`, `ticket_link`, `notes`, `started_at`, `completed_at`, `duration_seconds`, `created_at`, `updated_at`. All text columns are `TEXT` (widened so multiple PR authors fit); an index exists on `(frontend_branch, backend_branch)`.

`status` values: `Success`, `In Progress`, `Failed`, `Cancelled`, `Rolled Back`, plus `Rerun - <status>` (see below). Note `lib/db.ts` does not list the `Rerun - …` values in its `Deployment` type.

### Rerun behaviour
When the webhook receives a payload whose `ticket_link` (the GitHub Actions run URL) already exists, it **inserts a new row** with status `Rerun - <status>` and notes prefixed `🔄 Rerun:` — the original failed row is kept in history (earlier versions updated in place). The one-off `GET /api/migrate` cleanup deletes `Failed` rows that have a later `Success` row for the same `ticket_link`.

## Setup

```bash
npm install
# create .env.local (git-ignored) with the variables below
npm run dev                  # http://localhost:3000
```

`next dev` against Neon works only with network access to Neon; set `USE_MOCK_DATA=true` (development only) to enable the mock flag exported by `lib/db.ts`.

### Environment variables

| Variable | Used by | Notes |
|----------|---------|-------|
| `DATABASE_URL` | all DB routes | Neon pooled connection string. **Never commit it.** |
| `WEBHOOK_SECRET` | `POST /api/webhook` | Expected as `Authorization: Bearer <secret>`. **If unset, the code falls back to a publicly known default** — always set it. |
| `ADMIN_TOKEN` | `middleware.ts`, `/api/auth` | Admin password. **If unset, falls back to a publicly known default** — always set it. |
| `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` | `/api/jira/*` | Jira Cloud site URL and an Atlassian API token (Basic auth, server-side only). Unset → `/jira` shows setup instructions |
| `JIRA_DONE_STATUSES` | `/api/jira/stats` | Optional, comma-separated status names to treat as shipped/done (in addition to Jira's Done category and names like Done/Closed/Released/Deployed) |
| `JIRA_PROJECT_KEYS` | `/api/jira/stats`, key detection | Comma-separated project keys (e.g. `CORE,EMR`); required for metrics, and limits which `ABC-123` patterns count as tickets |
| `GCHAT_ALERT_WEBHOOK_URL` | `lib/alerts.ts` | Optional Google Chat webhook: alerts on failed **production** deployments and on production recovery with time-to-restore vs target (lower environments never alert) |
| `MTTR_TARGET_MINUTES` (default `30`) | `lib/alerts.ts` | MTTR target a recovery message is compared with |
| `GH_TOKEN` | `/api/compare` | GitHub token with read access to the compared repos |
| `USE_MOCK_DATA` | `lib/db.ts` | Dev-only mock flag |

Rotate the Neon password and admin/webhook secrets if they were ever committed to git history (earlier versions of these docs contained them).

## API

All `GET`s are public. `POST/PUT/PATCH/DELETE` need admin auth (see `AUTHENTICATION.md`) except `/api/webhook` (own secret) and `/api/auth*`.

| Endpoint | Description |
|----------|-------------|
| `GET /api/deployments?limit=&offset=` | History, newest first (default 500, max 1000). Rows whose `deployed_by` contains "Deployment Tracker" are excluded. ETag + 30 s edge cache |
| `POST /api/deployments` | Manual create (admin) |
| `PATCH /api/deployments/[id]` | Update any columns present in the body (admin) |
| `DELETE /api/deployments/[id]` | Delete (admin) |
| `GET /api/environments` · `POST` · `DELETE /api/environments/[id]` | Environment list/create/delete (writes need admin). 120 s edge cache |
| `POST /api/webhook` | CI ingestion (Bearer `WEBHOOK_SECRET`). Required: `environment`, `status`. Accepts the deployment columns above; `deployment_type` defaults to `standard`, `started_at` to now, `duration_seconds` is computed from `completed_at`. Returns `201 {success, deployment}`. `GET` is a liveness check |
| `GET /api/health` | Latest `Success` deployment per environment (used by `/health`; 60 s edge cache). It is **not** a live probe |
| `GET /api/cluster-health` | Live probes of 9 backend API URLs (Preview, Demo-Preview, QA, Stage, Stage EUW2, Pre-Prod India, Pre-Prod USW, Prod Ankura, Prod Neotia) — `HEALTHY` (2xx/3xx ≤ 2000 ms), `DEGRADED` (slow or 4xx/5xx), `OFFLINE` (timeout 4.5 s / network error). 120 s edge cache. Backend only — there is no frontend/CloudFront chunk probe |
| `GET /api/compare?repo=&base=&head=&run_id=` | GitHub compare (ahead/behind, ≤30 commits, ≤50 files) between two refs; with only `head`, last 15 commits; optional Actions run details. Default repo `vidaisolutions/vidai-react`. Needs `GH_TOKEN` |
| `GET /api/drift?repo=frontend\|backend` | Commits pending promotion between adjacent pipeline branches (GitHub compare, edge cache 120 s; needs `GH_TOKEN`) |
| `GET /api/jira/filters` · `GET /api/jira/search?<filters>&sort=&limit=` | Option lists for the filter bar (people, types, priorities, statuses, labels, components, fix versions; cached 1 h) and the filtered ticket explorer (total + up to 200 issues). **Filter params** accepted by `search`, `stats` and `insights`: `assignee` (accountIds or `unassigned`), `reporter` (accountIds), `type`, `priority`, `status`, `label`, `component`, `version` (comma separated), `from` / `to` (created date, `YYYY-MM-DD`) and `q` (text). Values are validated and quoted before being put in JQL (admin) |
| `GET /api/jira/insights?stuckDays=` · `GET /api/jira/release-notes[?id=]` | Ready-to-ship / stuck / bug trends / lead time; release-notes picker and per-deployment markdown (admin) |
| `GET /api/jira/issues?keys=` · `GET /api/jira/stats?days=` · `GET /api/jira/deployed` | Jira data (**admin session or `Bearer ADMIN_TOKEN` required** — unlike other GETs, because summaries/assignees are internal). `issues` resolves up to 100 keys; `stats` returns exact counts over all issues of `JIRA_PROJECT_KEYS` (Jira's approximate-count API), counts per workflow stage, open bugs, and the active sprint(s) from the Agile API (assignee breakdown samples the 500 most recently updated open issues); `deployed` maps keys → environments from the last 300 successful deployments. Uses Jira's `POST /rest/api/3/search/jql` |
| `GET /api/admin/stats` | Aggregates + DORA metrics for `/admin` (admin session required) |
| `GET/POST /api/migrate` | One-off schema/data maintenance (adds FE/BE columns, widens columns to TEXT, renames `Demo`→`Demo-Preview`, dedupes superseded failed rows). Idempotent; both POST and GET need admin |
| `POST /api/auth`, `DELETE /api/auth`, `GET /api/auth/session` | Admin login / logout / role check |

## CI/CD

- `.github/workflows/deploy.yaml` — build and deploy to Vercel (`vercel pull/build/deploy --prebuilt --prod`) on push to `main` or manual dispatch. Secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.
- Feeding the tracker from `vidai-devops` deploys: see `AUTOMATIC_TRACKING.md` and `log-deployment-workflow.yaml`.

## Scripts (`scripts/`)

One-off importers/backfills: `import-history.js` (GH Actions runs, `--since`, `--dry-run`), `import-gh-history-rds.js`, `import-history-md.js` / `import-prod-history.js` (from `DEPLOYMENT-HISTORY-2026-08-24.md`), `fix-imported-actors.js` (actor backfill), `add-deployment-type.sql`.

## Project structure

```
app/
  DriftRibbon.tsx     # promotion radar
  page.tsx            # main dashboard (cards, history, compare, QA cadence, admin controls)
  admin/page.tsx      # DORA + telemetry
  health/page.tsx     # latest-success view
  jira/page.tsx       # Jira dashboard
  api/{deployments,environments,webhook,health,cluster-health,compare,admin/stats,jira,migrate,auth}/
lib/db.ts             # pg Pool + types
lib/alerts.ts         # Google Chat failure / recovery alerts (called by the webhook)
lib/auth.ts           # isAdminRequest for GET routes with internal data
lib/jira.ts           # Jira Cloud client, key extraction, admin check for /api/jira/*
middleware.ts         # admin auth for non-GET /api/*
scripts/              # importers
.github/workflows/    # deploy.yaml
```

## Related docs

`AUTHENTICATION.md` · `AUTOMATIC_TRACKING.md` · `QUICKSTART_AUTO_TRACKING.md` · `docs/ROADMAP.md` · historical setup logs: `SETUP_COMPLETE.md`, `DEPLOY_TO_VERCEL.md`, `DEPLOYMENT_SUCCESS.md`, `INTEGRATION_COMPLETE.md`, `REDESIGN_COMPLETE.md`.
