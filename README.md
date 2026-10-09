# VidAI Deployment Tracker

Deployment tracking, release-governance and delivery-metrics dashboard for VidAI. Next.js 16 (App Router) + Neon Postgres + Tailwind 4, deployed to Vercel (`https://vidai-deployments.vercel.app`) by `.github/workflows/deploy.yaml` on every push to `main`.

> Next.js 16 has breaking changes vs. older versions — read `node_modules/next/dist/docs/` before changing framework-level code (see `AGENTS.md`).

## Pages

Everything is one page with tabs: `/?tab=<id>` (the default, `/`, is Deployments). The tab and the shell (top bar, theme, health dots) are shared; the old URLs redirect (`next.config.ts`): `/classic` → `/`, `/jira` → `?tab=tickets`, `/admin` → `?tab=insights`, `/health` → `?tab=health`, `/home` → `?tab=my-view`, `/pipeline` → `?tab=pipeline`.

| Tab | What it is |
|-----|-----------|
| **Deployments** (`/`) | Admin toolbar (Refresh, Export JSON, sign-in; when admin: Deploy release, Targets, Import JSON, Sign out), telemetry tiles and 14-day timeline, environment cards (live probe, FE/BE branch + version, last FE/BE deploy, failure/stale banner), promotion radar and QA release windows (approval gate), then the full deployment history: filters, sorting, select-two compare (commits and files via `/api/compare`), detail drawer, Edit/Delete for admins; the Ticket / Notes column shows the workflow-run link, FE/BE/PR links and notes |
| **Pipeline** | Board of tickets by furthest environment with a ticket drawer (journey stepper, per-env state) from `GET /api/pipeline` |
| **My view** | Role lenses (Developer, QA, Release, Management); the lens is kept in `localStorage` `tracker-lens` and `?as=dev\|qa\|rel\|mgmt`. A lens changes the view only, it grants no permissions |
| **Tickets** | The Jira dashboard, **open to everyone** (no sign-in; set `JIRA_PUBLIC_READ=false` to require an admin session again): filter bar, KPI tiles, sprint, bugs, ready-to-ship, stuck tickets, bug trends, lead time, release notes, ticket explorer with CSV export, tickets-by-environment. Needs `JIRA_*` env vars |
| **Insights** | Delivery metrics (admin sign-in): headline tiles, DORA suite, by environment / status, recent failures, longest runs, operator leaderboard, recovery audit trail (`GET /api/admin/stats`) |
| **Health** | Per-environment live probe (`/api/cluster-health`), freshness and last successful deploy (`/api/health`) |

Sections inside a tab are standalone components that talk through window events: `tracker:data-changed`, `tracker:refresh`, `tracker:compare`, `tracker:edit-deployment`, `tracker:delete-deployment`, `tracker:auth-changed`. `AdminGate` shows a sign-in card on Tickets and Insights for non-admins.

## Environments and ordering

Environments are rows in the `environments` table and are **auto-created by the webhook** on first sight. The UI orders cards by `display_order`:

`Preview (1)` → `Demo-Preview (1.5)` → `QA (2)` → `Stage / Stage EUW2 (3)` → `Pre-Prod (4)` → `Pre-Prod USW (5)` → `Production (Ankura) (6)` → `Production (Neotia/Babyjoy) (7)` → `Production (8)` → `LMS (9)`.

Branch → environment map used for compare: `dev`→Preview, `demo`→Demo-Preview, `qa`→QA, `stage`→Stage, `preprod`→Pre-Prod, `preprod_usw`→Pre-Prod USW, `prod_ank`→Production (Ankura), `prod_neo`→Production (Neotia/Babyjoy).

Environment name resolution (`normalizeEnvironment` in `app/api/webhook/route.ts`) matches, in order, against the raw environment + notes + branch names: `euw2` → Stage EUW2; `use1` → Stage USE1; `demo` / `preview-ecs-cluster` / `demo-preview` → **Demo-Preview** (checked *before* QA so PR titles like "QA to Demo" don't match QA); `preview` → Preview; `qa-aps` / `qa` (raw env only) → QA; pre-prod USW; pre-prod; `prod-ank`/`ankura`; `prod-neo`/`neotia`/`babyjoy`; `refera`; `prod`; `stage`; `lms`. Unknown names are cleaned (`-ecs-cluster` stripped) and registered as-is; an empty/`Other` environment falls back to **Demo-Preview**.

## Database

Neon Postgres (`DATABASE_URL`, pooled connection, SSL, pool max 20).

**environments** — `id` (UUID), `name` (unique), `is_production`, `display_order`, `created_at`, `updated_at`.

**deployments** — `id` (UUID), `environment`, `status`, `deployment_type` (`standard` | `rollback` | `hotfix`), `branch`, `version`, `frontend_branch`, `backend_branch`, `frontend_version`, `backend_version`, `requested_by`, `approved_by`, `tested_by`, `deployed_by`, `ticket_link`, `notes`, `started_at`, `completed_at`, `duration_seconds`, `created_at`, `updated_at`. All text columns are `TEXT` (widened so multiple PR authors fit); an index exists on `(frontend_branch, backend_branch)`.

`status` values: `Success`, `Queued`, `In Progress`, `Failed`, `Cancelled`, `Rolled Back`, plus `Rerun - <status>` (see below). `Queued` and `In Progress` are the two **open** (non-final) statuses. Note `lib/db.ts` does not list the `Rerun - …` values in its `Deployment` type.

### Rerun behaviour
When the webhook receives a payload whose `ticket_link` (the GitHub Actions run URL) already exists, it **inserts a new row** with status `Rerun - <status>` and notes prefixed `🔄 Rerun:` — the original failed row is kept in history (earlier versions updated in place). The one-off `GET /api/migrate` cleanup deletes `Failed` rows that have a later `Success` row for the same `ticket_link`.

### Two-phase reporting (In Progress, then final status)
A pipeline can report the same run twice and the tracker updates the **same row**. Always send `ticket_link` = the Actions run URL (`.../actions/runs/<run_id>`) in both posts.

**POST 1 — pipeline start** (`status: "In Progress"`, no `completed_at`):
```bash
curl -X POST "$TRACKER_WEBHOOK_URL" -H "Authorization: Bearer $TRACKER_WEBHOOK_SECRET" -H "Content-Type: application/json" -d '{
  "environment":"qa-aps-ecs-cluster","status":"In Progress","deployment_type":"standard",
  "branch":"qa","version":"v1.2.3","frontend_branch":"qa","backend_branch":"qa",
  "requested_by":"alice","deployed_by":"GitHub Actions",
  "ticket_link":"https://github.com/org/repo/actions/runs/123456789",
  "notes":"Pipeline started","started_at":"2026-10-09T10:00:00Z"}'
```
**POST 2 — pipeline end** (same fields, final `status` = `Success` | `Failed` | `Cancelled` | `Rolled Back`, same `started_at`, plus `completed_at` and final `notes`):
```bash
curl -X POST "$TRACKER_WEBHOOK_URL" -H "Authorization: Bearer $TRACKER_WEBHOOK_SECRET" -H "Content-Type: application/json" -d '{
  "environment":"qa-aps-ecs-cluster","status":"Success","deployment_type":"standard",
  "branch":"qa","version":"v1.2.3","deployed_by":"GitHub Actions",
  "ticket_link":"https://github.com/org/repo/actions/runs/123456789",
  "notes":"Deployed; migrations applied","started_at":"2026-10-09T10:00:00Z","completed_at":"2026-10-09T10:08:30Z"}'
```
Matching rules (inside one transaction, serialised per `ticket_link` + environment):
- A row matches when it has the same `ticket_link`, the same **normalised** environment and status `Queued`, `In Progress`, `Rerun - Queued` or `Rerun - In Progress` (newest first). The environment is normalised from the environment + notes + branches. If a **final** post finds no exact match, it falls back to in-progress rows with the same `ticket_link` in any environment: when exactly one exists it is updated in place and keeps its own environment (a `console.warn` logs both names; alerts use the row's environment); with zero or several, legacy behaviour applies (one run URL may legitimately report several environments). `Queued` / `In Progress` posts never use the fallback (exact match only).
- Final status + matching row: the row is **updated in place** (status, notes, `completed_at`, `duration_seconds` from the row's original `started_at`; branches/versions/people only when non-empty in the payload; `updated_at = NOW()`). A `Rerun - ` status prefix and `🔄 Rerun:` notes prefix are preserved. Response `200 {success, deployment, updated: true}`. Production failure / recovery alerts fire here, once.
- `In Progress` + matching open row: idempotent update of notes (and non-empty fields), `200`, no new row. If the row is `Queued` it is upgraded in place to `In Progress` (or `Rerun - In Progress`); its original `started_at` is kept.
- `Queued` is sent when a deploy run is **waiting behind an earlier deployment in the same FIFO lane** (cluster/component); notes should name the blocking run. It inserts a row like `In Progress` (no `completed_at`/duration, no alert). Transitions are always in place: `Queued` -> `In Progress` -> final, or `Queued` -> final. A `Queued` post for a row that is already `In Progress` never downgrades it (status kept, notes refreshed; e.g. the second lane of a both-component deploy). A duplicate `Queued` post is idempotent (`200`).
- Sparse `Queued` / `In Progress` posts (empty branch/version/people fields) never overwrite populated columns of the existing row.
- `Queued` / `In Progress` + only completed rows for that `ticket_link` (GitHub "re-run all jobs" keeps the run id): inserts a `Rerun - Queued` / `Rerun - In Progress` row (notes `🔄 Rerun: ...`), `201`.
- Final status and no in-progress row: unchanged legacy behaviour (insert, or `Rerun - <status>` insert if the `ticket_link` exists), `201`.
- `Queued` / `In Progress` never compute a duration (`completed_at` / `duration_seconds` stay null) and **never alerts**. A stale `Queued` / `In Progress` row blocks nothing; it is simply the row the next final post for that run updates.

## Setup

```bash
npm install
# create .env.local (git-ignored) with the variables below
npm run dev                  # http://localhost:3000
```

`next dev` against Neon works only with network access to Neon; set `USE_MOCK_DATA=true` (development only) to enable the mock flag exported by `lib/db.ts`.

### Local preview without Neon

To run the app (including `/home` and `/pipeline`) without access to Neon, point the dev server at a throwaway Postgres. `lib/db.ts` always connects with `ssl: { rejectUnauthorized: false }`, so the local server must have **TLS enabled** (a self-signed certificate is enough; a plain non-TLS Postgres is refused).

1. Start a disposable Postgres with `ssl = on` and a self-signed cert/key (e.g. a container with `openssl req -x509 -nodes -newkey rsa:2048 -subj /CN=localhost` and `-c ssl=on -c ssl_cert_file=… -c ssl_key_file=…`).
2. Create the `environments` and `deployments` tables with the columns listed under [Database](#database) (all text columns `TEXT`; `id` UUID with a default such as `gen_random_uuid()`; `started_at` / `completed_at` timestamps). Insert a few rows, or post some through `POST /api/webhook`.
3. Set `DATABASE_URL` for the dev process only, e.g. `DATABASE_URL=postgres://…@localhost:<port>/<db> npm run dev` — do not put it in a committed file.

Jira stays off in this setup (see Known limits), so tickets appear with keys only.

### Environment variables

| Variable | Used by | Notes |
|----------|---------|-------|
| `DATABASE_URL` | all DB routes | Neon pooled connection string. **Never commit it.** |
| `WEBHOOK_SECRET` | `POST /api/webhook` | Expected as `Authorization: Bearer <secret>`. **If unset, the code falls back to a publicly known default** — always set it. |
| `ADMIN_TOKEN` | `middleware.ts`, `/api/auth` | Admin password. **If unset, falls back to a publicly known default** — always set it. |
| `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` | `/api/jira/*` | Jira Cloud site URL and an Atlassian API token (Basic auth, server-side only). Unset → the Tickets tab shows setup instructions |
| `JIRA_PUBLIC_READ` | `/api/jira/*`, Tickets tab, Jira fields on `/api/pipeline` | Default **true**: Jira data is readable without signing in. Set `false` to require an admin session again (the Tickets tab then shows a sign-in card) |
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
| `POST /api/webhook` | CI ingestion (Bearer `WEBHOOK_SECRET`). Required: `environment`, `status`. Accepts the deployment columns above; `deployment_type` defaults to `standard`, `started_at` to now, `duration_seconds` is computed from `completed_at`. Returns `201 {success, deployment}` for inserts, or `200 {success, deployment, updated: true}` when an `In Progress` row for the same run is updated (see [Two-phase reporting](#two-phase-reporting-in-progress-then-final-status)). `GET` is a liveness check |
| `GET /api/health` | Latest `Success` deployment per environment (used by `/health`; 60 s edge cache). It is **not** a live probe |
| `GET /api/cluster-health` | Live probes of 9 backend API URLs (Preview, Demo-Preview, QA, Stage, Stage EUW2, Pre-Prod India, Pre-Prod USW, Prod Ankura, Prod Neotia) — `HEALTHY` (2xx/3xx ≤ 2000 ms), `DEGRADED` (slow or 4xx/5xx), `OFFLINE` (timeout 4.5 s / network error). 120 s edge cache. Backend only — there is no frontend/CloudFront chunk probe |
| `GET /api/compare?repo=&base=&head=&run_id=` | GitHub compare (ahead/behind, ≤30 commits, ≤50 files) between two refs; with only `head`, last 15 commits; optional Actions run details. Default repo `vidaisolutions/vidai-react`. Needs `GH_TOKEN` |
| `GET /api/drift?repo=frontend\|backend` | Pending-commit counts per promotion pair (anchored on the last merged promotion PR; edge cache 120 s; needs `GH_TOKEN`) |
| `GET /api/drift/commits?repo=&base=&head=` | Every commit in `base...head`, newest first — loaded when a radar chip is opened (newest 300; beyond that the UI links to the GitHub compare view). Has a text filter in the UI |
| `GET /api/jira/filters` · `GET /api/jira/search?<filters>&sort=&limit=` | Option lists for the filter bar (people, types, priorities, statuses, labels, components, fix versions; cached 1 h) and the filtered ticket explorer (total + up to 200 issues). **Filter params** accepted by `search`, `stats` and `insights`: `assignee` (accountIds or `unassigned`), `reporter` (accountIds), `type`, `priority`, `status`, `label`, `component`, `version` (comma separated), `from` / `to` (created date, `YYYY-MM-DD`) and `q` (text). Values are validated and quoted before being put in JQL (admin) |
| `GET /api/jira/quality?days=` | Time to resolve and reopened bugs for the Tickets tab (public unless `JIRA_PUBLIC_READ=false`): bugs resolved per week with median/mean/p90 hours, by priority, distribution and the 10 slowest; reopen events per week, a cohort reopen rate (share of bugs first resolved in the window that were later reopened) and the recently reopened bugs. "Resolved" = reached QA Passed or any later stage; time to resolve = created until the first time that happened. Reads Jira changelogs (up to 800 bugs, `truncated` / `previousComplete` flags when a cap cuts the data); cached 2 min, `?fresh=1` bypasses |
| `GET /api/jira/insights?stuckDays=` · `GET /api/jira/release-notes[?id=]` | Ready-to-ship / stuck / bug trends / lead time; release-notes picker and per-deployment markdown (admin) |
| `GET /api/jira/issues?keys=` · `GET /api/jira/stats?days=` · `GET /api/jira/deployed` | Jira data (**admin session or `Bearer ADMIN_TOKEN` required** — unlike other GETs, because summaries/assignees are internal). `issues` resolves up to 100 keys; `stats` returns exact counts over all issues of `JIRA_PROJECT_KEYS` (Jira's approximate-count API), counts per workflow stage, open bugs, and the active sprint(s) from the Agile API (assignee breakdown samples the 500 most recently updated open issues); `deployed` maps keys → environments from the last 300 successful deployments. Uses Jira's `POST /rest/api/3/search/jql` |
| `GET /api/pipeline?sinceDays=` | Tickets grouped by furthest environment for `/home` and `/pipeline`. `sinceDays` 1–90 (default 30) bounds the non-success rows; successes are always the latest 300 non-tracker deployments. Ticket keys come from notes, branches, versions and ticket link (`JIRA_PROJECT_KEYS` filter). `Rerun - Success` counts as success; cancelled rows are ignored. Response: `generatedAt`, `configured`, `jiraAuthorised`, `jiraError`, `window {deployments, oldest, truncated}`, `columns[]` (id, name, environments, rank, isProduction, `health`, `activeDeploy`, `ticketCount`), `tickets[]` (max 150, newest first: `key`, `column`, `reached`, per-environment `environments` entries with state/first/last time/versions/deployer/run URL, `ageInStageDays`, `badges` hotfix/rolled_back/failed/stuck, plus Jira fields), `unlinked.deployments`, `notInJira`, `truncated`. **Deployment data is public; Jira fields** (`summary`, `type`, `priority`, `status`, `stage`, `assignee`, `url`) **are filled only for an admin session and only when `JIRA_*` is configured** — otherwise they are `null`. `Cache-Control`: `public, s-maxage=30, stale-while-revalidate=60` for anonymous, `private, max-age=30` for admin |
| `GET /api/admin/stats` | Aggregates + DORA metrics for the Insights tab (admin session required) |
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
  (v2)/               # the whole UI (route group; one page, tabs via /?tab=)
    layout.tsx        # ShellProvider + AppShell (Suspense), loads tokens.css / shell.css
    page.tsx          # picks the tab from ?tab=
    tabs.ts           # tab ids, labels and hrefs
    AppShell.tsx      # top bar (theme, env health dots, role switch on My view), tab nav
    ctx.tsx ui.tsx    # lens + pipeline state; shared components and usePipeline()
    AdminGate.tsx     # sign-in card for Tickets and Insights
    DeploymentsTab.tsx  # ReleaseAdmin, ReleaseStats, ReleaseEnvs, ReleaseRadar, ReleaseHistory, ReleaseCompare
    PipelineTab.tsx  MyViewTab.tsx (DevLens QaLens RelLens MgmtLens)  TicketDrawer.tsx
    TicketsTab.tsx    # Jira dashboard
    InsightsTab.tsx InsightsLists.tsx   # DORA + telemetry
    HealthTab.tsx     # live probes + freshness
    tokens.css shell.css   # design tokens and shell styles, scoped to .v2
  api/{deployments,environments,webhook,health,cluster-health,compare,admin/stats,jira,migrate,auth}/
  api/pipeline/route.ts   # GET /api/pipeline
lib/pipeline.ts       # buildPipeline(): deployments -> tickets/columns, optional Jira enrichment
lib/pipeline-types.ts # client-safe response types for /api/pipeline
lib/db.ts             # pg Pool + types
lib/alerts.ts         # Google Chat failure / recovery alerts (called by the webhook)
lib/auth.ts           # isAdminRequest for GET routes with internal data
lib/jira.ts           # Jira Cloud client, key extraction, admin check for /api/jira/*
middleware.ts         # admin auth for non-GET /api/*
scripts/              # importers
.github/workflows/    # deploy.yaml
```

## Known limits

- No Jira data without `JIRA_BASE_URL` / `JIRA_EMAIL` / `JIRA_API_TOKEN` (and `JIRA_PROJECT_KEYS`) **and** an admin login. Anonymous viewers, and any environment without those variables, see ticket keys and deployment data only (`summary`, assignee, status, stuck badges are empty; `/pipeline` and the lenses show a note). Jira enrichment covers at most 100 tickets per response.
- `/api/drift` (promotion radar, also shown in the Release lens) and `/api/compare` need `GH_TOKEN`; without it the radar does not load.
- `/api/pipeline` looks at the latest 300 successful deployments plus up to 300 non-success rows within `sinceDays`, and returns at most 150 tickets (`window.truncated` / `truncated` flag it). Tickets are only found when a Jira key appears in the deployment notes, branch, version or ticket link.
- The redesign is additive: `/home`, `/pipeline` and `/api/pipeline` are new; existing routes, APIs and the database schema are unchanged. The top-bar search is a placeholder (not implemented yet).
- Design background: `docs/REDESIGN-PROPOSAL-ROLE-BASED-UX.md` and `docs/redesign/`.

## Related docs

`AUTHENTICATION.md` · `AUTOMATIC_TRACKING.md` · `QUICKSTART_AUTO_TRACKING.md` · `docs/ROADMAP.md` · historical setup logs: `SETUP_COMPLETE.md`, `DEPLOY_TO_VERCEL.md`, `DEPLOYMENT_SUCCESS.md`, `INTEGRATION_COMPLETE.md`, `REDESIGN_COMPLETE.md`.
