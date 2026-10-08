# Deployment Tracker + Jira Dashboard — Role-Based Redesign Proposal

**Status:** Proposal for review (no app code changed) · **Mockup:** `docs/redesign-mockup.html` (open in a browser; sample data is fake)

## 1. Problem with today's UI

| Today | Pain |
|-------|------|
| `/` (env cards + history + radar + admin buttons), `/admin` (DORA), `/jira` (10+ sections), `/health` | Four separate pages, each answers a different question for a different person, but all are shown to everyone. |
| Jira data and deployment data are joined only in one matrix on `/jira` | The real question — "where is ticket X right now?" — needs two pages and a manual cross-read. |
| `/jira` is one long scroll of sections | Devs, QA and management each need ~2 of the 10 sections and scroll past the rest. |
| Auth is binary: viewer / admin | Jira data is admin-only, so anyone who isn't the admin sees none of the Jira value. |
| Admin controls live inline on the main dashboard | Clutter for viewers; risk of accidental edits. |

## 2. Principles

1. **Ticket-centric.** The unit people care about is a Jira ticket moving through `dev → qa → stage → preprod → prod`. Deployments are events on that journey.
2. **One shell, role lenses.** A single app shell with a role switcher. A lens changes the *home page and default filters*, not permissions. Everything stays reachable from the nav.
3. **Answer first, detail on demand.** Each role home is one screen (no scroll at 1080p) of "what needs my attention", with drill-down into the existing detail views.
4. **Calm by default.** Colour only for state that needs action (failed, blocked, stuck, degraded).
5. **Keep what works.** Webhook ingestion, DB schema, drift radar, DORA maths, JQL filter bar and CSV export are reused unchanged.

## 3. Information architecture

```
Shell: top bar [logo] [role lens] [global search: ticket key / version / PR] [env health dots] [theme] [account]
Left nav:
  Home      -> role-specific landing (section 4)
  Pipeline  -> NEW: board, columns = environments, cards = tickets (+ FE/BE versions)
  Tickets   -> today's ticket explorer + filter bar, with a "where deployed" column
  Releases  -> deployment history, compare, release notes, ready-to-ship queue
  Insights  -> DORA, lead time, bug trends, change failure rate (today's /admin + /jira insights)
  Health    -> live cluster probes + latest successful deploy per env
  Settings (admin) -> environments, import, webhook test, roles
```

Old URLs redirect so bookmarks keep working: `/jira` → `/tickets`, `/admin` → `/insights`, `/` → `/home`.

## 4. Role lenses

| Lens | Home answers | Home contents (all from existing APIs) | Default filters |
|------|--------------|-----------------------------------------|-----------------|
| **Developer** | "Is my work out, and is anything of mine broken?" | My tickets by stage (assignee = me); my PRs waiting in the promotion radar; my last deploys + status; failed deploys involving my branch | assignee = me |
| **QA** | "What can I test, and what can ship?" | **Ready to test** per env (deployed, not yet QA Passed); **QA-passed, not shipped** queue; open bugs by priority; QA release-window countdown (1:30 / 4:00 PM IST) | status in QA stages |
| **Release / DevOps** | "Is the pipeline healthy and is anything blocked?" | Live env health strip; in-progress + failed deploys; migration-gate status; promotion radar (drift per pair); hotfix backport status; stuck tickets | all envs, last 24 h |
| **Management** | "How are we delivering?" | DORA tiles (frequency, lead time, CFR, MTTR) with 30-day trend; shipped this week/sprint; sprint progress; open-bug trend; prod incidents | sprint, 30 days |

The lens is stored per browser (`localStorage`) and in the URL (`?as=qa`) so views are shareable.

## 5. New screens

### 5.1 Pipeline board (the centrepiece)
Columns: Preview · Demo · QA · Stage · Pre-Prod · Prod (Ankura) · Prod (Neotia). Cards: ticket key + title + assignee, FE/BE version chips, age-in-stage, badges (`Hotfix`, `Rolled back`, `Stuck 5d`). Column header shows env health dot and last deploy time. Data: `deployments` (versions/branches/notes) joined to Jira keys via the existing `/api/jira/deployed` extraction.

### 5.2 Ticket drawer
Click any ticket anywhere → right-side drawer: Jira status, linked PRs, a horizontal journey (`Dev ✓ QA ✓ Stage ● Pre-Prod ○ Prod ○`) with deploy timestamps and run links, release-note snippet, copy-link.

### 5.3 Global search
`⌘K`: ticket key, version, branch, deployer. Jumps to the ticket drawer or the deployment row.

## 6. Visual design system

- **Tokens**, light + dark parity, VidAI brand palette kept; semantic status colours (success / warning / danger / info / neutral), each with a text-safe variant (WCAG AA ≥ 4.5:1).
- **Type:** system UI stack, 13 px data / 14 px body, tabular numerals for counts and durations.
- **Density toggle:** comfortable / compact (tables and board).
- **Components:** status pill (icon + text, never colour alone), stat tile with sparkline, env health dot, version chip, journey stepper, filter chips (replace the long filter bar with chips + "More filters"), empty / error / loading skeletons for every panel.
- **Responsive:** nav collapses to bottom tabs on phones; board becomes a per-env accordion; tables become cards.
- **Motion:** only for state change (pulse on in-progress); respects `prefers-reduced-motion`.
- **Polling:** keep 90 s visible-tab polling; show "updated 40 s ago" and a manual refresh.

## 7. Access model (decision needed)

Today Jira GETs require the admin token, so non-admins see no Jira data. For role lenses to be useful, pick one:

| Option | Effect | Cost |
|--------|--------|------|
| **A. Company SSO (Google Workspace, @vidaisolutions.com): `viewer` reads Jira panels; `admin` keeps write** | Everyone internal sees real data; identity enables "assignee = me". | Auth.js + Google OAuth app; env vars; Jira accountId mapping by email. |
| B. Keep shared admin password; lens only changes layout | No auth work. | No "me" filtering (user picks a name from a dropdown); Jira stays admin-only. |
| C. Make Jira panels public read | Simplest. | Internal ticket titles/assignees exposed publicly on Vercel — not recommended. |

**Recommendation: A**, with writes (edit/delete/import/env management) staying admin-only and moved under Settings.

## 8. API / data changes

| Change | Why |
|--------|-----|
| `GET /api/pipeline` — tickets grouped by environment (reuses `/api/jira/deployed` + `/api/jira/issues`) | Pipeline board in one call, cached 60 s |
| `GET /api/tickets/[key]` — Jira issue + deployments + PRs + journey | Ticket drawer |
| `GET /api/me` — `{email, role, jiraAccountId}` | Lens defaults, "my work" |
| Optional: webhook also records `pr_number`, `jira_keys[]` per deployment | Removes regex guessing from notes/branches; makes the journey exact |
| No DB table changes required for phases 1–3 | Lower risk |

## 9. Delivery plan

| Phase | Scope | Risk |
|-------|-------|------|
| 0 | Approve this proposal + mockup; decide access option | — |
| 1 | App shell, design tokens, nav, route redirects; restyle existing pages inside the shell | Low |
| 2 | Role homes (Dev, QA, Release, Mgmt) assembled from existing APIs | Low |
| 3 | `/api/pipeline` + Pipeline board + ticket drawer + global search | Medium |
| 4 | SSO + `/api/me` (if option A) | Medium (auth) |
| 5 | Webhook enrichment (`jira_keys`, `pr_number`), mobile polish, a11y audit | Low |

Each phase ships through the existing Vercel pipeline (`deploy.yaml` on push to `main`); verify on a Vercel preview deployment before merging.

## 10. Open questions

1. Access option A, B or C?
2. Which Jira statuses mean "Ready to test" and "QA Passed" exactly (the ready-to-ship queue already keys on *QA Passed*)?
3. Should the Management view be visible to non-engineers (then mask assignee names)?
4. Keep the Google Sites / EC2 tracker variants, or retire them (they would not get the redesign)?
