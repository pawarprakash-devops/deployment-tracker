# VidAI Branching Strategy & Deployment Tracker — Engineering Roadmap

**Date:** 2026-09-07  
**Author:** Prakash Pawar (DevOps)  
**Status:** Approved Architecture & Roadmap  
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
  In `.github/workflows/deploy.yml`:
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
        -H "x-tracker-secret: ${{ secrets.TRACKER_WEBHOOK_SECRET }}" \
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

#### The Problem:
Teams frequently ask: *"Are all the QA bug fixes currently in Pre-Prod?"* or *"What commits in Stage have not been released to Production yet?"*

#### The Feature:
* A real-time **Promotion Pipeline Ribbon** across the top of the Tracker.
* Shows linear promotion flow with ahead/behind badges:
  - `Preview → QA`: `+4 commits ahead` (Cyan)
  - `QA → Stage`: `+2 commits ahead` (Yellow)
  - `Pre-Prod → Prod`: `IN SYNC` (Green) or `3 COMMITS PENDING RELEASE` (Amber).
* Clicking the badge opens a **Diff Modal** displaying the exact PR titles and authors waiting to be promoted.

#### Implementation:
Add endpoint `/api/git/drift` leveraging the GitHub Octokit API:
```ts
// GET /api/git/drift?base=prod_ank&head=preprod
const compare = await octokit.rest.repos.compareCommits({
  owner: 'vidaisolutions',
  repo: 'vidai-backend',
  base: 'prod_ank',
  head: 'preprod'
});
return NextResponse.json({
  ahead_by: compare.data.ahead_by,
  behind_by: compare.data.behind_by,
  commits: compare.data.commits.map(c => ({ sha: c.sha, message: c.commit.message, author: c.author?.login }))
});
```

---

### 3.2 Live Cluster Health Checks (`/api/cluster-health`)

#### The Problem:
The tracker currently displays the *last known deployment status*. If an ECS container runs out of memory (OOMKilled) 3 hours later, the tracker still displays "Success".

#### The Feature:
* An active telemetry worker probes each environment's health endpoint every 60 seconds:
  - **Preview:** `https://99999.preview.vidaisolutions.com/api/health`
  - **QA:** `https://qa-aps.vidaisolutions.com/api/health`
  - **Stage:** `https://stage.vidaisolutions.com/api/health`
  - **Pre-Prod India:** `https://pre-prod.vidaisolutions.com/api/health`
  - **Pre-Prod USW:** `https://pre-prod-usw.vidaisolutions.com/api/health`
  - **Production:** `https://production.vidaisolutions.com/api/health`
* Display on the Environment Card:
  - `● HEALTHY` (200 OK · 42ms latency) with glowing green indicator.
  - `▲ DEGRADED` (500/502/504 or >2000ms latency) with amber pulse.
  - `✖ OFFLINE` (Connection refused/timeout) with red incident banner.

---

### 3.3 Full DORA Metrics Suite on `/admin`

* **Status:** ✅ **Implemented & Verified** (Live on `/admin` at `vidai-deployments.vercel.app/admin`).
* **Implementation Summary:**
  - Automated continuous measurement of delivery velocity and system recovery stability based on real database records.
  - Dedicated production CFR (`prodCfrRate`) alongside fleet-wide CFR.
  - True MTTR service restoration calculation (chronological delta between `Failed` runs and the subsequent `Success` on that environment).
  - High-visibility **Incident Recovery & MTTR Audit Trail** table displaying target environment, outage start, recovery timestamp, time to restore (MTTR), recovery operator, and direct links to failure and fix GitHub Actions workflow runs.

| Metric | Definition | VidAI Target | Live Tracker Value | Status |
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

* **Additional Tracker Webhooks:**
  - When deployment status changes to `Failed` in any lower environment ➔ Send high-priority alert with direct links to failure logs.

---

### 3.5 1-Click Rollback Runbook & Dispatcher

* **Operator Convenience:** In the `/admin` dashboard or directly on Environment Cards, authenticated operators have a **Rollback** button.
* **Safety Controls:**
  - Requires Admin token authentication.
  - Confirmation modal showing: `"Target: vidai-prod | Reverting to: commit a1b2c3d (v2.14.2)"`.
  - Dispatches GitHub Actions workflow dispatch with `action: rollback` and target commit SHA.

---

### 3.6 Scheduled Release Windows & Approval Gate Countdown (QA 1:30 PM & 5:30 PM IST)

* **Status:** ✅ **Implemented & Verified** (Live on `/` at `vidai-deployments.vercel.app`).
* **The Problem:**
  - QA branch merges were triggering continuous ad-hoc deployments, causing testing interruptions, DB lock collisions, and untracked config drift.
  - New policy enforces **only two QA deployments daily**: **1:30 PM IST** and **5:30 PM IST**, requiring mandatory DevOps approval.
* **The Tracker Enhancement:**
  - **Live Countdown Timer:** Displays on the QA card (e.g., `⏱ Next QA Release in 1h 24m · 01:30 PM IST` ticking live).
  - **Window Status Badges:** Transitions dynamically through `COUNTDOWN` ➔ `CLOSING IN` (within 30m) ➔ `WINDOW ACTIVE` (during 15m deployment window).
  - **Approval Gate Indicator:** Visual badge displaying `GATE: MANDATORY APPROVAL (@pawarprakash-devops)`.

---

### 3.7 Dynamic Cluster & Multi-Region Auto-Discovery

* **Status:** ✅ **Implemented & Verified** (Live in `/api/webhook`, `app/page.tsx`, and `app/admin/page.tsx`).
* **The Problem:**
  - Deployments to newly spun-up clusters or non-standard environments (e.g., `stage-euw2`, dynamic preview clusters) previously fell into the `Other` category because cluster names were hardcoded in static maps.
* **The Solution:**
  - **Pattern Resolver:** Regex auto-detection in `/api/webhook` dynamically extracts region and tier (`*-euw2*` ➔ `Stage EUW2`, `*-aps*` ➔ Mumbai, etc.).
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

### 3.9 Frontend Chunk Load 503 & Cache-Control Health Telemetry

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
├── [ ] Environment Promotion Drift Matrix (Ahead/Behind ribbon on /)
├── [x] QA Scheduled Release Windows countdown (1:30 PM & 5:30 PM IST)
├── [x] Dynamic Cluster Auto-Discovery (Resolving stage-euw2 out of 'Other')
└── [x] PR Deep-Linking & GitHub Operator Avatars

PHASE 4: Emergency Response & Advanced Guardrails
├── [ ] 1-Click Rollback Dispatcher from Tracker UI
├── [ ] Frontend Chunk Load 503 & Cache Health Probe
└── [ ] Multi-channel alerts for Failed runs & MTTR threshold breaches
```

---

## 5. Security & Architectural Compliance

1. **Non-Modifiable Constraints:** No modifications will be made to `evaseq-api` or the preview database (`vidai-db-pre-prod`).
2. **Account Segregation:** Development and Staging remain strictly isolated on AWS Account `816069151152`; Production remains isolated on AWS Account `025277631094`.
3. **Secret Security:** All webhook tokens and API keys are stored in AWS Secrets Manager or encrypted GitHub Actions repository secrets (`TRACKER_WEBHOOK_SECRET`).
