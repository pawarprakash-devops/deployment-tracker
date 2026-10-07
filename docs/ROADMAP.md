# VidAI Branching Strategy & Deployment Tracker — Engineering Roadmap

**Date:** 2026-09-07 (code-synced 2026-10-07)  
**Author:** Prakash Pawar (DevOps)  
**Status:** Approved Architecture & Roadmap — implementation status below reflects the code on `main` (`bc7249a`)  
**Applicable Repositories:**  
- `vidaisolutions/vidai-backend` (Django Core / ECS Fargate & EC2)  
- `vidaisolutions/vidai-react` (React Web / S3 + CloudFront)  
- `vidaisolutions/vidai-devops` (Centralized Workflows & Configurations)  
- `pawarprakash-devops/deployment-tracker` (Live Telemetry & Dashboard at `vidai-deployments.vercel.app`)

---

## 1. Executive Summary

This specification outlines the next-phase operational enhancements for VidAI's software delivery lifecycle. It builds upon the environment-isolated branching architecture (`dev` → `qa` → `stage` → `preprod` → `prod_*`) and defines specific enhancements for the **Branching Strategy** and the **Deployment Tracker**.

### Core Objectives:
1. **Zero Production Divergence:** Prevent un-promoted hotfixes from disappearing when subsequent normal releases occur.
2. **Automated SemVer & Release Audit:** Automatically tag production releases and trace git commits across environments.
3. **Environment Parity Visibility:** Expose real-time "Ahead / Behind" commit drift between pipeline stages in the Deployment Tracker.
4. **Live Telemetry & Availability:** Augment the tracker with real-time health pings to target ECS clusters, moving from passive logs to active monitoring.

---

## 2. Branching Strategy Enhancements

```
NORMAL PROMOTION PIPELINE:
[feature/*] ──► [dev] (Preview) ──► [qa] (QA) ──► [stage] (Stage) ──► [preprod] (Pre-Prod) ──► [prod_ank] & [prod_neo] (Prod)

HOTFIX FAST-TRACK & BACKPORTING WORKFLOW:
                   ┌───────────────────────────────┐
                   │  hotfix/CORE-XXX-description  │ ◄── branched from prod_ank
                   └───────────────┬───────────────┘
                                   │
                ┌──────────────────┴──────────────────┐
                ▼                                     ▼
      [Emergency Prod Deploy]                 [Auto-Backport PR]
   PR into prod_ank & prod_neo                 PR into stage & dev
     (DevOps Approval Gate)                   (Auto-created by Actions)
```

### 2.1 The Standardized Hotfix Fast-Track Workflow

When an emergency defect or critical outage strikes Production (`prod_ank` or `prod_neo`), moving a bugfix sequentially through all five lower environments is impractical. However, patching production directly risks code regression when the next planned release is promoted.

#### Hotfix Lifecycle Rules:
1. **Branch Creation:** The engineer branches directly off the latest `prod_ank`:
   ```bash
   git checkout prod_ank
   git pull origin prod_ank
   git checkout -b hotfix/CORE-XXX-short-description
   ```
2. **Validation:** Hotfixes must be tested either:
   - On the Preview cluster via a targeted preview run (`vidai-solutions-stage` / `preview-99999`), or
   - Locally with targeted integration tests.
3. **Production PR & Approval:**
   - Target branch: `prod_ank` (and cherry-picked to `prod_neo`).
   - Approvals required: **1 Tech Lead** (`saranya13-tech` or `kuldeeplodha` for backend; `dev-prafulk` for frontend) + **DevOps Lead** (`pawarprakash-devops`).
4. **Automated Reverse Backporting (GitHub Action):**
   - Upon merge to `prod_ank`, an automated workflow triggers `kodiakhq/backport` or a GitHub Action script:
     ```yaml
     name: Auto Backport Hotfix
     on:
       pull_request:
         types: [closed]
         branches: [prod_ank]
     jobs:
       backport:
         if: github.event.pull_request.merged == true && startsWith(github.event.pull_request.head.ref, 'hotfix/')
         runs-on: ubuntu-latest
         steps:
           - uses: actions/checkout@v4
           - name: Create Backport PR to dev and stage
             uses: repo-sync/pull-request@v2
             with:
               destination_branch: "dev"
               pr_title: "[BACKPORT] ${{ github.event.pull_request.title }} into dev"
     ```
   - **Guaranteed Outcome:** Fixes merged into production are instantly integrated into `dev` and `stage`, eliminating regression bugs.

---

### 2.2 Automated Semantic Release Tagging (`semver`)

Currently, deployments identify commits and branch names, but lack standardized version identifiers.

#### Implementation:
On every successful deployment to `prod_ank` or `prod_neo`:
1. The deployment workflow analyzes commit messages (following [Conventional Commits](https://www.conventionalcommits.org/)):
   - `fix:` bumps PATCH (`v2.14.1`)
   - `feat:` bumps MINOR (`v2.15.0`)
   - `BREAKING CHANGE:` bumps MAJOR (`v3.0.0`)
   - *Fallback pattern:* Calendar versioning `vYYYY.MM.DD.#` (e.g., `v2026.09.07.1`).
2. GitHub Action automatically creates an annotated Git Tag:
   ```bash
   git tag -a v2.15.0 -m "Release v2.15.0: Production Ankura"
   git push origin v2.15.0
   ```
3. The release tag is broadcast via the webhook to the Deployment Tracker database, populating the `version` column and displaying `🏷 v2.15.0` on the dashboard.

---

### 2.3 PR Actor Attribution Fix

* **Issue Identified:** When automatic pipelines deploy (`Full_Deploy_V2`), the deployment tracker recorded `pawarprakash-devops` (the token owner) instead of the developer who authored the pull request.
* **Resolution in GitHub Actions:**
  In the `vidai-devops` deploy workflows (note: the webhook authenticates with `Authorization: Bearer`, not `x-tracker-secret`):
  ```yaml
  - name: Extract Deployment Trigger Actor
    id: actor
    run: |
      if [ "${{ github.event_name }}" = "pull_request" ]; then
        echo "DEPLOY_USER=${{ github.event.pull_request.user.login }}" >> $GITHUB_OUTPUT
      elif [ "${{ github.event_name }}" = "workflow_dispatch" ]; then
        echo "DEPLOY_USER=${{ github.actor }}" >> $GITHUB_OUTPUT
      else
        echo "DEPLOY_USER=${{ github.triggering_actor }}" >> $GITHUB_OUTPUT
      fi

  - name: Notify Deployment Tracker
    run: |
      curl -X POST https://vidai-deployments.vercel.app/api/webhook \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer ${{ secrets.TRACKER_WEBHOOK_SECRET }}" \
        -d '{
          "environment": "${{ inputs.environment }}",
          "status": "Success",
          "deployed_by": "${{ steps.actor.outputs.DEPLOY_USER }}",
          "requested_by": "${{ steps.actor.outputs.DEPLOY_USER }}"
        }'
  ```

---

## 3. Deployment Tracker Enhancements

The Deployment Tracker (`pawarprakash-devops/deployment-tracker`) has already been upgraded with the **DevOps Cyber Cockpit** theme on both `/` and `/admin`. The following architectural enhancements will transform it into an end-to-end mission control system.

```
┌────────────────────────────────────────────────────────────────────────┐
│               VIDAI DEPLOYMENT COMMAND CENTER — PROMOTION RADAR        │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   Preview (dev) ────[+4 commits]────► QA (qa) ────[+2 commits]────►   │
│   SHA: 7f8a12c                       SHA: 3d4e910                      │
│                                                                        │
│   ► Stage (stage) ────[+1 commit]────► Pre-Prod ────[IN SYNC]────►    │
│     SHA: 1a2b3c4                       SHA: 9b8a7c6                    │
│                                                                        │
│   ► Production (prod_ank)                                              │
│     SHA: 9b8a7c6 [● LIVE HEALTH: 200 OK (38ms)]                       │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Environment Promotion Drift Matrix (Ahead / Behind Delta)

* **Status:** ✅ **Implemented** as the **Promotion Radar** strip above the environment cards on `/` (`app/DriftRibbon.tsx`, `GET /api/drift`).
* For the backend or frontend repo (toggle) it compares adjacent pipeline branches — `dev→qa`, `qa→stage`, `stage→preprod`, `preprod→prod_ank`, `preprod→prod_neo` — and shows `IN SYNC` or `+N pending`; clicking a chip lists the pending commits (sha, message, author, link). Results are edge-cached for 120 s and need `GH_TOKEN` on the server.
* The older two-deployment **compare modal** (`GET /api/compare`) remains for diffing arbitrary refs.

---

### 3.2 Live Cluster Health Checks (`/api/cluster-health`)

* **Status:** ✅ **Implemented** (PR #6, extended for Stage EUW2 and Demo-Preview).
* `GET /api/cluster-health` probes **9 backend API URLs** server-side on each (edge-cached, 120 s) request; the dashboard calls it on load and every **90 s while the tab is visible** (plus "probe now"):

| Environment | Probe URL |
|---|---|
| Preview | `https://99999.preview-api.vidaisolutions.com/api/` |
| Demo-Preview | `https://preview-api.vidaisolutions.com/api/` |
| QA | `https://qa-aps-api.vidaisolutions.com/api/` |
| Stage | `https://stage-api.vidaisolutions.com/api/` |
| Stage EUW2 | `https://staging-euw2-api.vidaisolutions.com/api/` |
| Pre-Prod (India) | `https://pre-api.vidaisolutions.com/api/` |
| Pre-Prod USW | `https://pre-prod-usw-api.vidaisolutions.com/api/` |
| Production (Ankura) | `https://production-api.vidaisolutions.com/api/` |
| Production (Neotia/Babyjoy) | `https://production-aps-api.vidaisolutions.com/api/` |

* Classification: `HEALTHY` = 2xx/3xx in ≤ 2000 ms; `DEGRADED` = 2xx/3xx slower than 2000 ms, or 4xx/5xx; `OFFLINE` = timeout (4.5 s) or connection failure. (The earlier design's `/api/health` frontend paths and 60 s server-side worker were not built; `GET /api/health` is a different endpoint — latest successful deploy per environment.)
* Stage USE1, Pre-Prod USW frontends and all CloudFront frontends have **no** probe (see §3.9).

---

### 3.3 Full DORA Metrics Suite on `/admin`

* **Status:** ✅ **Implemented & Verified** (Live on `/admin` at `vidai-deployments.vercel.app/admin`).
* **Implementation Summary:**
  - Automated continuous measurement of delivery velocity and system recovery stability based on real database records.
  - Dedicated production CFR (`prodCfrRate`) alongside fleet-wide CFR.
  - True MTTR service restoration calculation (chronological delta between `Failed` runs and the subsequent `Success` on that environment).
  - High-visibility **Incident Recovery & MTTR Audit Trail** table displaying target environment, outage start, recovery timestamp, time to restore (MTTR), recovery operator, and direct links to failure and fix GitHub Actions workflow runs.

| Metric | Definition | VidAI Target | Value at time of writing (2026-09-11; live values come from `/api/admin/stats`) | Status |
|---|---|:---:|:---:|:---:|
| **Deployment Frequency** | How often code is successfully deployed | Daily | **14.7 / day** | **Elite** |
| **Lead Time for Changes** | Time from commit creation to production release | < 24 Hours | **~14.2h** | **Elite** |
| **Change Failure Rate** | Percentage of deployments causing production failure | < 5% | **< 4.5%** (Prod) | **Elite** |
| **Mean Time to Recovery (MTTR)**| Time from incident alert to subsequent successful deployment | < 30 Mins | **28 Mins** (Median: 27.6m) | **Elite** |

---

### 3.4 Multi-Channel Alert Webhooks (Google Chat / Slack / Discord / Teams)

* **Google Chat Notifications for Production Deployments:**
  - ✅ **Implemented & Verified** via [PR #194](https://github.com/vidaisolutions/vidai-devops/pull/194) (`feat/gchat-prod-deploy-notifications`).
  - **Bot Identity:** `Vidai_DevOps` (configured via Space ➔ Apps & integrations ➔ Webhooks).
  - **Secret:** `GCHAT_WEBHOOK` stored securely in `vidaisolutions/vidai-devops`.
  - **Triggers:**
    - **Deployment Started:** Early notification in `config` job as soon as target cluster, branch, and Docker tag validations pass.
    - **Deployment Finished:** Final notification in `log-deployment` job (`if: always()`) reporting status (✅ Success, ❌ Failed, ⚠️ Cancelled), release version, cluster, deployer handle, and direct workflow run link.
  - **Target Workflows:**
    - `prod_deployment.yaml` (Ankura Production)
    - `prod-account-full-deploy.yaml` (Neotia / Babyjoy Production)
  - Detailed plan: [deployment_gchat_notifications_plan.md](file:///home/pawarpr/Desktop/WSL-Backup/deployment_gchat_notifications_plan.md).

* **Tracker alerts (✅ implemented, optional):** set `GCHAT_ALERT_WEBHOOK_URL` and the tracker's webhook posts to Google Chat on every failed deployment (🚨 *PRODUCTION* for prod environments) and when an environment recovers, including time-to-restore vs `MTTR_TARGET_MINUTES` (default 30). Not built: a reminder while an incident is still open (needs a scheduler).

---

### 3.5 1-Click Rollback Runbook & Dispatcher

* **Status:** ❌ **Not implemented — deliberately paused.** A design exists (admin-only `POST /api/rollback` dispatching the `rollback` action of the vidai-devops workflows with typed confirmation, a code-only/no-DB-revert acknowledgement for prod, and a `GH_DISPATCH_TOKEN` with Actions write on vidai-devops), but it was not built because it lets the tracker trigger production workflows; decide first who may do that. Today the tracker only *records* rollbacks (`deployment_type = rollback`, status `Rolled Back`, and a "ROLLBACK AUDIT" HUD counter on `/`); it cannot dispatch a workflow.

* **Operator Convenience:** In the `/admin` dashboard or directly on Environment Cards, authenticated operators have a **Rollback** button.
* **Safety Controls:**
  - Requires Admin token authentication.
  - Confirmation modal showing: `"Target: vidai-prod | Reverting to: commit a1b2c3d (v2.14.2)"`.
  - Dispatches GitHub Actions workflow dispatch with `action: rollback` and target commit SHA.

---

### 3.6 Scheduled Release Windows & Approval Gate Countdown (QA 1:30 PM & 4:00 PM IST)

* **Status:** ✅ **Implemented & Verified** (Live on `/` at `vidai-deployments.vercel.app`).
* **The Problem:**
  - QA branch merges were triggering continuous ad-hoc deployments, causing testing interruptions, DB lock collisions, and untracked config drift.
  - New policy enforces **only two QA deployments daily**: **1:30 PM IST** and **4:00 PM IST** (manual dispatch also allowed), requiring mandatory DevOps approval.
* **The Tracker Enhancement:**
  - **Live Countdown Timer:** Displays on the QA card (e.g., `⏱ Next QA Release in 1h 24m · 01:30 PM IST` ticking live).
  - **Window Status Badges:** Transitions dynamically through `COUNTDOWN` ➔ `CLOSING IN` (within 30m) ➔ `WINDOW ACTIVE` (during 15m deployment window).
  - **Approval Gate Indicator:** Visual badge displaying `GATE: MANDATORY APPROVAL (@pawarprakash-devops)`.
  - Windows are hardcoded in `app/page.tsx` (`W1` = 13:30, `W2` = 16:00 IST, 15-minute window each); keep in sync with `QA-DEPLOY-SCHEDULE-AND-AUTO-DEPLOY-REMOVAL-2026-10-06.md`.

---

### 3.7 Dynamic Cluster & Multi-Region Auto-Discovery

* **Status:** ✅ **Implemented & Verified** (Live in `/api/webhook`, `app/page.tsx`, and `app/admin/page.tsx`).
* **The Problem:**
  - Deployments to newly spun-up clusters or non-standard environments (e.g., `stage-euw2`, dynamic preview clusters) previously fell into the `Other` category because cluster names were hardcoded in static maps.
* **The Solution:**
  - **Pattern Resolver:** Regex auto-detection in `/api/webhook` dynamically extracts region and tier (`euw2` ➔ `Stage EUW2`, `use1` ➔ `Stage USE1`, `demo`/`preview-ecs-cluster` ➔ `Demo-Preview`, `prod_ank`/`ankura` ➔ `Production (Ankura)`, `prod_neo`/`neotia`/`babyjoy` ➔ `Production (Neotia/Babyjoy)`, etc. — see `README.md`).
  - **Demo-Preview:** the former "Other"/"Demo" bucket is now the named `Demo-Preview` environment (preview.vidaisolutions.com, branch `demo`, ordered after Preview). It is matched *before* QA so PR titles like "QA to Demo" don't land in QA; unresolved environments also default to it. `GET /api/migrate` renames old `Demo` rows.
  - **Self-Registering Environments:** Automatically inserts newly encountered clusters into the `environments` database table on the first webhook event.
  - **Frontend Dynamic Fallback:** `getClusterInfo(envName)` dynamically resolves region and cluster tags for any target environment.

---

### 3.8 PR Deep-Linking, Commit Metadata & Operator Avatars

* **Status:** ✅ **Implemented & Verified** (Live across cards, history table, leaderboard, and MTTR audit trail).
* **The Problem:**
  - Pipelines triggered by automated workflows often show `@GitHub Actions` or service tokens rather than the actual PR author.
  - PR references in notes or commit messages (`#617930`, `PR-452`) were plain text.
* **The Solution:**
  - **Automatic PR Parsing:** Detects `#<number>` and `PR #<number>` patterns in notes and branches, creating 1-click links directly to GitHub PRs.
  - **Author Avatar Badges:** Displays circular user avatar thumbnails with initials fallbacks for team members (`Sonali Mathur`, `kuldeeplodha`, `pawarprakash-devops`, `saranya13-tech`, `dev-prafulk`).

---

### 3.10 Jira Dashboard (`/jira`)

* **Status:** ✅ **Implemented** (needs `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEYS` in Vercel).
* Ticket chips (`🎫 CORE-123`) appear in the deployment history table for any Jira-style key in notes/branches/ticket link; admins also see status and a link to Jira.
* `/jira` (admin only): exact counts over all issues of `JIRA_PROJECT_KEYS` — open, in development, in QA/QA passed, open bugs, created vs done (7 d and window) — plus breakdowns by **workflow stage** (Backlog → In Development → Review/QA → QA Passed → Deployed/Done, mapped from status names in `stageOf()`; "Preview Deployed" counts as pre-QA), by status and by assignee (sampled), the open-bug list, the **active sprint** (Agile API: dates, goal, progress by stage/status) and a **tickets × environments** matrix ("is VID-123 in Pre-Prod yet?").
* **Insights:** ready-to-ship queue (QA Passed, flagged with environments seen), stuck tickets (idle ≥ N days in dev/review/QA statuses), weekly bug created-vs-closed (8 weeks), open bugs by priority and age, lead time (created → done via `statuscategorychangedate`, created → first prod deploy), and per-deployment release notes (markdown).
* "Done" = moved into a Done-category status or a status named Done/Closed/Resolved/Released/Deployed (override with `JIRA_DONE_STATUSES`).
* **Feeding the matrix:** deployment records only contain a Jira key if the workflow sends it. [vidai-devops#232](https://github.com/vidaisolutions/vidai-devops/pull/232) adds ` · Jira: VID-123` to the notes of the v2 / Ankura / Neotia deploy workflows (from the PR title, head branch, body and commits). Scheduled QA deploys and LMS deploys carry no PR, so they have no keys yet.

---

### 3.9 Frontend Chunk Load 503 & Cache-Control Health Telemetry

* **Status:** ❌ **Not implemented** — `/api/cluster-health` probes backend APIs only.

* **The Problem:**
  - After new frontend releases to S3/CloudFront, client browsers often experience `ChunkLoadError: Loading chunk [hash] failed (503)` if `index.html` is cached or old chunks are purged prematurely.
* **The Solution:**
  - Integrate a frontend bundle health probe into `/api/cluster-health`:
    1. Validates `index.html` headers (`Cache-Control: no-cache, no-store, must-revalidate`).
    2. Probes JS chunk bundles referenced in `index.html` to ensure they return `200 OK` from CloudFront edge locations.
    3. Displays `⚠️ STALE CDN CHUNKS` warning on frontend environment cards if cache invalidation is pending or chunks are missing.

---

## 4. Phased Implementation Roadmap

```
PHASE 1: Core Automation & Attributions (Completed)
├── [x] PR Actor Attribution fix in GitHub Actions
├── [x] Standardized Hotfix Backporting Workflow specification
└── [x] Google Chat Prod Deployment Notifications (PR #194)

PHASE 2: Active Telemetry & Observability (Completed)
├── [x] Live Cluster Health Check API & visual status pills (/api/cluster-health)
├── [x] On-demand telemetry probing (🔄 PROBE NOW)
└── [x] Full DORA Metrics Suite & MTTR Recovery Audit Trail on /admin

PHASE 3: Release Governance & Flow Control (Active)
├── [x] Environment Promotion Drift Matrix (Promotion Radar)
├── [x] Rerun tracking (`Rerun - <status>` rows) and Demo-Preview environment
├── [x] Light/dark theme toggle + VidAI brand palette; 90 s visible-tab polling + edge caching
├── [x] QA Scheduled Release Windows countdown (1:30 PM & 4:00 PM IST)
├── [x] Dynamic Cluster Auto-Discovery (Resolving stage-euw2 out of 'Other')
└── [x] PR Deep-Linking & GitHub Operator Avatars

PHASE 4: Emergency Response & Advanced Guardrails
├── [ ] 1-Click Rollback Dispatcher from Tracker UI
├── [ ] Frontend Chunk Load 503 & Cache Health Probe
└── [~] Alerts for Failed runs & MTTR (Google Chat done; Slack/Teams and open-incident reminders not built)
```

---

## 5. Security & Architectural Compliance

1. **Non-Modifiable Constraints:** No modifications will be made to `evaseq-api` or the preview database (`vidai-db-pre-prod`).
2. **Account Segregation:** Development and Staging remain strictly isolated on AWS Account `816069151152`; Production remains isolated on AWS Account `025277631094`.
3. **Secret Security:** All webhook tokens and API keys are stored in AWS Secrets Manager or encrypted GitHub Actions repository secrets (`TRACKER_WEBHOOK_SECRET`).
