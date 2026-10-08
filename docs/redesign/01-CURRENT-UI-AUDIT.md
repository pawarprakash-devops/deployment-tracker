# 01 - Current UI Audit (read-only)

Scope: `app/page.tsx` (3413 lines), `app/jira/page.tsx` (524), `app/admin/page.tsx` (1916), `app/health/page.tsx` (202), `app/DriftRibbon.tsx` (123), `app/layout.tsx` (20). No app code changed. Companion: `docs/REDESIGN-PROPOSAL-ROLE-BASED-UX.md`.
Lenses: **Dev** = Developer, **QA**, **Rel** = Release/DevOps, **Mgmt** = Management. New IA: Home / Pipeline / Tickets / Releases / Insights / Health / Settings.
Line cites are `file:line`; `page` = `app/page.tsx`, `jira` = `app/jira/page.tsx`, `admin` = `app/admin/page.tsx`, `health` = `app/health/page.tsx`, `drift` = `app/DriftRibbon.tsx`.

Method note: `page` lines 1-1950 and 1950-3410 (all CSS, no JSX) and `admin` were read in part via parallel read-only sub-passes; `jira`, `health`, `drift`, `layout` and `page` 1-2050 were read directly. A few admin line numbers were spot-checked (:161, :494, :513, :1011, :1215); the rest rely on the sub-pass.

## 0. Shell facts

| Item | Finding | Cite |
|---|---|---|
| Layout | Root layout only loads Google Fonts (Montserrat, Inter) and `globals.css`; no nav, no shell, no skip link, no `<main>`. Every page re-implements its own header. | layout:9-19 |
| Theme | Each page keeps its own `theme` state; `/` and `/jira` share `localStorage['tracker-theme']`; `/admin` is always dark terminal style; `/health` is hard-coded light Tailwind (`bg-gray-50`). Four visual languages. | page:580-591, jira:44,65, health:97 |
| Styling | styled-jsx in each page: ~1460 CSS lines inside `page.tsx` (1949-3410), ~900 in admin (1014-1913), ~35 in jira. Two overlapping rule sets for the same class names inside `page.tsx`. | page:1949-3410 |
| Auth | Binary: `/api/auth/session`. Main page: viewer sees data, admin sees edit controls and Jira chips. `/jira` and `/admin` are admin-only (blank or login gate for viewers). | page:595, jira:67,166, admin:304 |
| Polling | Main 90 s visible-tab (page:725); admin 90 s (admin:161); health 90 s (health:30); drift 5 min (drift:30); jira none (manual only). | as cited |

## 1. Inventory: every section/widget with its API

### 1.1 `/` (app/page.tsx)

| # | Section (lines) | Shows | API / data | Role lenses | New IA home |
|---|---|---|---|---|---|
| 1 | Header + live bar (1156-1211) | Title, live dot, "Updated", "Clusters" probe time, Refresh, link to /jira, theme toggle, admin buttons (Targets, Export, Import, Deploy Release, Telemetry, Logout) or Export + Admin Access | `GET /api/auth/session` (page:597), `DELETE /api/auth` (626) | All | App shell (top bar); admin buttons -> Settings |
| 2 | HUD telemetry (1214-1244) | "Cluster status OPERATIONAL" (hard-coded 1217), success rate, total runs, today's deploys, tracked targets, rollback events | Derived from `/api/deployments?limit=1000` (655, 1132-1137) | Mgmt, Rel | Home (Mgmt, Rel); success/rollback -> Insights |
| 3 | `<DriftRibbon/>` Promotion radar (1246; drift:49-96) | Per env-pair "+N pending" / "IN SYNC", FE/BE toggle, expandable commit list with filter | `GET /api/drift?repo=` (drift:24), `GET /api/drift/commits?repo&base&head` (drift:41) | Rel, Dev, QA | Pipeline (strip above board) + Home (Rel) |
| 4 | Environment cards (1249-1395) | Per env: name, region/cluster, prod badge, live probe pill + latency, consecutive-failure/stale banner, latest status/time/version, FE/BE branches, last deployer, last FE/BE deploy ago | `/api/deployments`, `/api/environments` (655-656), `/api/cluster-health` (636); health rules client-side (804-827) | All (core) | Pipeline (column headers) + Health (probe) + Home |
| 4a | QA release-cadence box (1306-1334) | Countdown to 1:30 / 4:00 PM IST window, "GATE: MANDATORY APPROVAL", hard-coded approver | Client clock `getQANextWindow` (253-334), ticks each second (518-523) | QA (primary), Rel | Home (QA, Rel) + Pipeline QA column |
| 5 | Deployment timeline, 14 days (1398-1427) | Stacked bars success/failed/other per day | Derived from deployments (848-873) | Mgmt, Rel | Insights (Mgmt), Home (Rel mini) |
| 6 | Compare bar (1430-1440) | "n/2 selected", Compare, Clear | State only | Dev, Rel | Releases |
| 7 | Filters (1443-1466) | Env, status, date, free-text search, count | Client filter over 1000 rows (1115-1125) | All | Releases (filter chips) + global search |
| 8 | History table (1469-1578) | Checkbox, env, status, FE/BE branch or branch+version, time + duration, requested/approved/tested by avatars, ticket link + PR chips + Jira chips (admin) + linkified notes, Edit/Del (admin) | `/api/deployments`; admin: `GET /api/jira/issues?keys=` (page:537) | Dev, QA, Rel | Releases (primary); ticket chips -> Tickets drawer |
| 9 | Footer (1580-1583) | Live dot, refresh claim, count | State | - | Drop (merge into shell "updated Ns ago") |
| 10 | Deploy modal (1587-1680) | Create/edit deployment form | `POST /api/deployments` (1053), `PATCH /api/deployments/:id` (1047) | Rel (admin) | Settings / Releases "Log deployment" |
| 11 | Environments modal (1683-1735) | List + delete, add env | `GET /api/environments` (1700), `DELETE /api/environments/:id` (1704), `POST /api/environments` (1725) | Admin | Settings |
| 12 | Login modal (1738-1750) | Admin password | `POST /api/auth` (607) | Admin | Shell account menu |
| 13 | Compare modal (1753-1947) | Field diff, time delta, FE/BE repo toggle, commits, files changed | `GET /api/compare?repo&base&head` (959, 972) | Dev, Rel, QA | Releases (drawer / page) |
| 14 | Export / Import JSON (1076-1113) | Client download; import loops `POST /api/deployments` per row | `POST /api/deployments` (1097) | Admin | Settings |
| 15 | Delete deployment (1066) | confirm() then delete | `DELETE /api/deployments/:id` (1069) | Admin | Settings / Releases row menu |

### 1.2 `/jira` (app/jira/page.tsx) - admin only

All sections load via one `load()` (jira:70-82) firing five requests in parallel; no polling.

| # | Section (lines) | Shows | API | Role lenses | New IA home |
|---|---|---|---|---|---|
| 1 | Header controls (116-131) | Window (7-90d), stuck threshold, Refresh, back link | - | All | Tickets/Insights toolbar |
| 2 | Filter bar (133-162) | 8 multi-selects, date range, text search, Apply/Clear, 5 presets, "N filters applied" note | `GET /api/jira/filters` (86); URL `?qs` sync (91) | Dev, QA, Mgmt | Tickets (chips + "More filters") |
| 3 | Login gate (166-174) / not-configured (176-185) | Admin password; env var help | `POST /api/auth` (105) | - | Remove gate if SSO; config help -> Settings |
| 4 | KPI tiles x9 (191-197) | Open, in dev, review+QA, open bugs, created/done 7d, created/done Nd, released to prod | `GET /api/jira/stats?days=&filters` (75) | Mgmt, QA, Dev | Home (Mgmt: Insights) |
| 5 | Active sprint panels (199-216) | Dates, days left, goal, by stage/status bars | stats (`sprints`) | Mgmt, Dev | Home (Mgmt), Insights |
| 6 | 3 bar panels (218-222) | By stage, by status, open by assignee | stats | Mgmt, Dev | Insights; "by assignee" -> Home (Dev "mine") |
| 7 | Open bugs table (224-227) | Key, summary, status, priority, assignee | stats `openBugs` | QA, Dev | Home (QA), Tickets preset |
| 8 | Ready to ship (233-239) | QA-Passed queue oldest first, not-in-prod count, idle days, deployed-to | `GET /api/jira/insights?stuckDays=&filters` (77) | QA, Rel | Home (QA, Rel), Releases "ready queue" |
| 9 | Stuck tickets (241-247) | Idle >= N days in-progress statuses | insights | Rel, Mgmt, Dev | Home (Rel), Pipeline badge `Stuck Nd` |
| 10 | Bug trends (249-258) | Weekly created vs closed chart, open bugs by priority and age | insights | QA, Mgmt | Insights |
| 11 | Lead time cards (260-269) | Median/p90 created->done, by type, created->first prod | insights | Mgmt | Insights |
| 12 | Release notes (271-285) | Pick deployment, render markdown, copy | `GET /api/jira/release-notes` (78), `?id=` (97) | Rel, Mgmt | Releases |
| 13 | Ticket explorer (287-300) | Sort, Export CSV, 10-column table | `GET /api/jira/search?sort=&filters` (79) | Dev, QA | Tickets (primary) |
| 14 | Tickets by environment matrix (302-329) | Ticket x env check marks from last 300 deploys | `GET /api/jira/deployed` (76) | All | Pipeline board (replaces matrix) + Tickets "where deployed" column |

### 1.3 `/admin` (app/admin/page.tsx) - admin only

| # | Section (lines) | Shows | API | Role lenses | New IA home |
|---|---|---|---|---|---|
| 1 | Header (499-532) | Terminal-style bar, "POLL: 60s" (actually 90 s), last audit, Return, Refresh, Logout | `/api/auth/session` (178), `DELETE /api/auth` (241) | - | Shell |
| 2 | Login gate (304-492) | Password form | `POST /api/auth` (220) | - | Shell |
| 3 | 6 HUD tiles (535-580) | Total, success %, failure %, avg runtime, today, 7-day | `GET /api/admin/stats` (200) | Mgmt, Rel | Insights (dedupe with `/` HUD) |
| 4 | DORA suite (583-716) | Overall tier + 4 cards (frequency, lead time, CFR, MTTR) with bars/targets | stats `dora` | Mgmt, Rel | Insights + Home (Mgmt) |
| 5 | By environment (720-767) | Counts/% bars + cluster chip | stats `byEnvironment` | Mgmt, Rel | Insights |
| 6 | By status (770-818) | Status distribution | stats `byStatus` | Mgmt | Insights |
| 7 | Recent failures (824-859) | FAIL tag, env, branch, notes | stats `recentFailures` | Rel, Dev | Home (Rel, Dev "mine"), Releases filter |
| 8 | Longest runs (862-890) | Slowest deployments | stats `slowestDeployments` | Rel | Insights |
| 9 | Operator leaderboard (893-927) | Top 10 users | stats `mostActiveUsers` | Mgmt | Insights (optional, mask names for non-eng) |
| 10 | Recovery audit table (931-1008) | Failed to recovered MTTR, run links | stats `dora.recentRecoveries` | Rel, Mgmt | Insights / Releases |

Note: `/admin` has no edit/delete/import/env management; those live on `/` (page:1194-1202). The redesign proposal's `/admin` -> `/insights` redirect is correct; admin writes move from `/` to Settings.

### 1.4 `/health` (app/health/page.tsx) and shell files

| # | Section | Shows | API | Roles | New IA home |
|---|---|---|---|---|---|
| 1 | Env health cards (health:113-193) | Freshness label from days-since-deploy (Fresh/Current/Aging/Stale), type, version, branch, deployed by, duration, last deployed | `GET /api/health` (health:47), 90 s poll | Rel | Health |
| 2 | Footer (196-198) | "Auto-refreshing every 10 seconds" (false) + `new Date()` at render | - | - | Replace with "updated Ns ago" |
| - | `layout.tsx` | Fonts, metadata | - | - | Becomes the app shell |

Gap: live probes (`/api/cluster-health`) exist only on `/` cards (page:636, 1284); `/health` shows deploy freshness, not liveness. Merge in the new Health page.

## 2. Role-lens mapping (what each lens needs)

| Capability | Dev | QA | Rel | Mgmt | Source today | Lands in |
|---|:-:|:-:|:-:|:-:|---|---|
| My tickets by stage (assignee = me) | X | | | | jira:221 (by assignee), explorer :287 | Home (Dev), Tickets |
| My PRs awaiting promotion | X | | X | | drift:41 | Home (Dev), Pipeline |
| My last deploys / failed deploys on my branch | X | | X | | page:1494 table | Home (Dev), Releases |
| Ready to test per env | | X | | | missing (needs status mapping, proposal Q2) | Home (QA), Pipeline |
| QA-passed not shipped | | X | X | | jira:233 | Home (QA), Releases |
| Open bugs by priority | X | X | | X | jira:224, 254 | Home (QA), Insights |
| QA window countdown | | X | X | | page:253, 1306 | Home (QA) |
| Env health strip + probes | | | X | | page:1284, health | Home (Rel), Health, shell dots |
| In-progress / failed deploys | | | X | | page:1341, admin:824 | Home (Rel), Pipeline |
| Migration gate / hotfix backport status | | | X | | not shown anywhere | New (Releases) |
| Promotion radar | X | X | X | | drift | Pipeline |
| Stuck tickets | X | | X | X | jira:241 | Home (Rel), Pipeline |
| DORA tiles + trend | | | X | X | admin:583 | Insights, Home (Mgmt) |
| Sprint progress | X | | | X | jira:199 | Home (Mgmt), Insights |
| Lead time, bug trend | | X | | X | jira:260, 249 | Insights |
| Release notes | | X | X | X | jira:271 | Releases |
| Deployment compare | X | | X | | page:1753 | Releases |
| Env/deploy admin writes | | | X (admin) | | page:1587, 1683 | Settings |

## 3. UX problems

Severity: **H** blocks a role goal or is a correctness bug, **M** degrades usability/a11y, **L** polish.

### 3.1 Scroll depth, ordering, duplication

| Sev | Problem | Cite |
|---|---|---|
| H | Main page stacks 7 blocks (header, HUD, radar, cards, timeline, compare bar, filters) before the table; at 1080p the working table starts below the fold. | page:1156-1469 |
| H | `/jira` is 14 sections in one scroll; Dev/QA each need ~2-3. Matrix of "where is ticket X" sits last (page bottom) although it is the core question. | jira:133-329 |
| H | Jira value is behind admin login; viewers get a login wall. | jira:166-174 |
| M | Compare bar is not sticky and sits between timeline and filters; invisible when picking rows from a 1000-row table. | page:1430-1440, 1494 |
| M | History table renders up to 1000 rows unpaginated, 9-10 columns (`min-width:1100px`). | page:655, 1494, CSS 2996 |
| M | Duplicated data: success/failure/total/today appear on `/` HUD (1214-1244) and `/admin` HUD (535-580); failure ratio appears 3x on admin (HUD, DORA CFR, status panel); "Updated" time in header and footer (1163, 1582); open bugs on both jira stats and bug trends; by-env counts in admin and cards. | as cited |
| M | Two Jira data paths for the same keys: `extractKeys` chips on `/` (page:411, 537) vs `/api/jira/deployed` matrix (jira:76); PR extraction by regex from notes in both. | page:344, 411 |
| M | Admin nested scroll areas (feeds cap at 420 px) plus unbounded recovery table. | admin:1350, 956 |
| L | Four unrelated visual languages (light Tailwind health, dark terminal admin, coral EMR main, minimal jira). | health:97, admin:1014 |

### 3.2 Correctness bugs that mislead users (fix during the rebuild)

| Sev | Bug | Cite |
|---|---|---|
| H | Footer claims "Auto-refreshing every 5s" (real 90 s); health claims 10 s (real 90 s, and `new Date()` is evaluated once per render); admin says "POLL: 60s" (real 90 s). | page:1582, health:197, admin:513 |
| H | `saveDeploy` / `deleteDeploy` / import never check `res.ok`; failed save closes the modal silently. Save also omits `frontend_branch`/`backend_branch`. | page:1045-1074, 1097 |
| H | Edit form slices `started_at` as UTC into a `datetime-local` input (timezone shift on save); new-deploy path offsets correctly. | page:1014 vs 988 |
| M | "Rerun - Success/Failed" counted in both success/failed and "other" buckets in the timeline; status filter lacks Rerun options. | page:863-865, 1450-1456 |
| M | Timeline and "today" use UTC dates; table renders local time. | page:854, 1136, 1536 |
| M | "CLUSTER STATUS: OPERATIONAL" is hard-coded, not derived from probes. Success rate defaults to the string `'100'` with no data. | page:1217, 1134 |
| M | Empty-table hint says "+ New Deployment" (button is "+ Deploy Release") and is shown to viewers who cannot add. | page:1490 vs 1200 |
| M | Admin: `if (!stats) return null` yields a blank page on first-load failure; DORA overall tier badge only styled for Elite/High so Low/Medium render green; bar scales are invented constants (`/5`, `/48`, `/120`). | admin:494, 1603-1610, 629-710 |
| L | Admin effect depends on `[isAdmin]` and refetches session on flips. | admin:174 |

### 3.3 Accessibility

| Sev | Problem | Cite |
|---|---|---|
| H | All four `/` modals are `div.overlay` with click-to-close: no `role="dialog"`, `aria-modal`, `aria-labelledby`, Escape handler, focus trap or focus restore. | page:1588, 1684, 1739, 1754 |
| H | Colour-only meaning: timeline segments and day bars (title only, not focusable), compare diff highlight, HUD tile stripes/values, admin MTTR badge, jira Idle (red/amber/grey), jira weekly chart (created vs closed distinguished by colour only), jira status text coloured by category, jira matrix and `statusCategory` colour, health card dot + "Fresh/Stale" colour badge. | page:1409-1419, CSS 2934; admin:537-577, 980; jira:419, 433-443, 41; health:137 |
| M | Form labels are not bound to inputs (`label` without `htmlFor`/`id`); required only by `*`; filter selects, date input and compare checkbox have no accessible name. | page:1593-1672, 1444-1458, 1499; admin:332 |
| M | Clickable non-buttons / non-links: header `window.location.href='/admin'` button; file input wrapped in styled `label`; jira MultiSelect backdrop `div onClick` with no Escape/keyboard dismiss and no `aria-expanded`/`role`. | page:1201, 1196; jira:472, 468 |
| M | No `:focus-visible` styles for buttons/links; `outline:none` on inputs relies on border colour. | page CSS 2294, 2966; admin:441 |
| M | Progress bars and bar charts (`jbar`, DORA bars) are divs with no `role="progressbar"`/text equivalent. | admin:626-631; jira:376-380 |
| M | `alert()`/`confirm()` used for 9+ messages (not announced consistently, blocks UI). | page:1028, 1062, 1067, 1072, 1105, 1108, 1698, 1723-1728 |
| M | Contrast/size: `--faint` text at 9-10.5 px; admin `#484F58` on `#0D1117` (~2.3:1). | page CSS (bar-label 9.5px, cadence 8.5px); admin:1406, 1509, 1670 |
| M | No landmarks (`<main>`, `<nav>`), no skip link, tables lack `<caption>`/`scope`; heading order skips (h2 -> h4). | layout:17; page:1470; admin:615 |
| L | Emoji used as icons/status with no `aria-hidden`; theme toggle lacks `aria-pressed`. | page:1190, 1348, 1554 |
| L | Reduced-motion guard covers some animations only; `pulse` keyframes used by in-progress dot and cadence dots; admin pulses unguarded. | page CSS 3396-3406, 2764; admin:1078, 1086 |
| L | Cards lift on hover though not interactive (false affordance). | page CSS 2595 |

### 3.4 Missing loading / empty / error states

| Sev | Gap | Cite |
|---|---|---|
| H | `loadData`, `probeClusterHealth` and `/api/health` failures only `console.error`; UI shows stale data with no banner and no "stale" marker. Health page swallows non-array responses (shows empty grid). | page:644, 712; health:52, 49 |
| H | Whole-page blocking spinner on `/` (no per-section skeleton); `/health` same; `/admin` blank. | page:1139-1146; health:88; admin:494 |
| M | Probe pill hidden when no probe result (no "checking"/"unknown" state). | page:1284 |
| M | Compare failure message blames a GitHub token without evidence; no error vs empty distinction. | page:1819-1823 |
| M | Jira: per-request `.catch` converts failures into `{error}` objects but `deployed` failure becomes `null` and the matrix section disappears silently; no skeletons; first paint blank while `loading`. | jira:75-81, 302 |
| M | Admin: missing empty states for env/status/leaderboard/slowest panels; login always says "Invalid operator token" for 401/429/500. | admin:733, 782, 905, 874, 230 |
| L | Import is sequential with no progress/failure report. | page:1095-1105 |

### 3.5 Mobile / responsive

| Sev | Problem | Cite |
|---|---|---|
| H | `page.tsx` has no width breakpoints (only a reduced-motion query). Table min-width 1100 px, 9-10 columns, no card fallback. | page CSS 2996, 3396 |
| H | Fixed modal widths overflow a 375 px phone: env 500, login 400, compare 750-900. | page:1685, 1740, 1755 |
| M | Env cards use `minmax(310px,1fr)` (overflows < ~342 px); compare grid `140px 1fr 1fr` never stacks; 2-col form grid never collapses. | page CSS 2575, 2915, 3372 |
| M | Admin 2-col grid `minmax(400px,1fr)` forces horizontal scroll under ~450 px; tap targets ~30 px. | admin:1215, 1113-1118 |
| M | Jira filter bar: 8 multi-select buttons + date + search wrap into ~4 rows on phones; popover `width:260px` left-anchored can clip off-screen; matrix has one column per env. | jira:134-151, 361 |
| L | `jira` and `health` have a responsive grid but no table-to-card pattern. | jira:351 |

### 3.6 Hard-coded data worth moving to config/API

| Item | Cite |
|---|---|
| `KNOWN_USERS` (real people + GitHub handles) duplicated in page and admin | page:125-142; admin:93-103 |
| Env maps: `PROMOTION_ORDER`, `ENV_DEFAULT_BRANCH`, `ENV_CLUSTER_MAP`, `STANDARD_BRANCHES`, synthetic "Stage EUW2" env | page:49-109, 697-705; admin:63-91; jira:40 |
| QA windows 1:30/4:00 PM IST, 15 min width, approver handle | page:270-272, 1325-1330 |
| Repo names `vidaisolutions/vidai-react`, `vidai-backend`; non-Jira key blacklist | page:372-379, 945, 410 |
| Health thresholds (3/2 failures, 14/30 days) | page:821-824; health:73-76 |
| Avatars fetched from `github.com/<handle>.png` per user (third-party request) | page:161; admin:116 |

## 4. Reuse list (extract into shared code)

### 4.1 Pure logic (`lib/`), safe to extract first, unit-testable

| Extract | From | Used by (new IA) |
|---|---|---|
| `timeAgo`, `formatDuration` (unify; admin/jira have variants) | page:759, 767; admin:249-264; drift:9 | All |
| `getStatusClass` -> status taxonomy (Success, Rerun-*, In Progress, Failed, Rolled Back, Cancelled) | page:746 | Pipeline, Releases, Home |
| `sortDeploymentsByLatest`, `latestForEnv`, `latestBranchesForEnv`, `getLastDeployTimes` | page:774-845 | Pipeline columns, Home |
| `getEnvHealth` (failure-streak/stale rules) with thresholds in config | page:804-827 | Health, Pipeline headers, shell dots |
| `getTimelineData` (fix UTC and Rerun double count) | page:848-873 | Insights, Home (Rel) |
| `getQANextWindow` (config-driven windows) | page:253-334 | Home (QA), Pipeline QA column |
| `extractKeys` + `NOT_JIRA`, `extractAllPRs`, `formatTicketLink`, `renderNoteWithLinks` | page:344-499, 876-920 | Pipeline cards, Tickets drawer, Releases |
| Jira filter model: `Filters`, `toQS`, `fromQS`, `activeCount`, `isoDaysAgo`, `EMPTY`, `LISTS` | jira:6-16 | Tickets |
| `exportCsv`, `exportJSON` | jira:516-524; page:1076 | Tickets, Settings |
| Types: `Deployment`, `Environment`, `ClusterHealthResult`, `Issue`, `Stats`, `Insights`, `DoraSuite` | page:6-47; jira:7-38; admin:6-61 | Shared `types/` (also used by API routes) |
| `ENV_CLUSTER_MAP`/`getClusterInfo`, `KNOWN_USERS`/`getAuthorAvatar` | page:94-169; admin:63-139 | `config/` or API |
| DORA bar fraction maths (named constants, tested) | admin:629, 654, 683, 710 | Insights |

### 4.2 Hooks

| Hook | Replaces | Cite |
|---|---|---|
| `usePolling(fn, ms)` with visibility handling + `lastUpdated` + `error` + `stale` | 4 copies of interval/visibility code | page:719-744; admin:154-174; health:25-43; drift:20-34 |
| `useDeployments()` / `useEnvironments()` / `useClusterHealth()` (shared cache so Home, Pipeline, Health do not refetch) | `loadData`, `probeClusterHealth` | page:633-717 |
| `useSession()` (role, login, logout; later `/api/me`) | three separate auth implementations | page:595-631; jira:67-107; admin:143-264 |
| `useJiraFilters()` (URL-synced) | jira filter state | jira:58-92 |
| `useLens()` (role lens in `localStorage` + `?as=`) | new | proposal 4 |

### 4.3 Components

| Component | Extract from | Notes |
|---|---|---|
| `AppShell` (top bar, left nav, lens switcher, search, env dots, theme, account) | layout:9-19 + 4 page headers | New |
| `StatusPill` (icon + text, never colour alone) | page `badge`/`health-pill`/`status-badge` (CSS 2302, 2665, 2747); admin status pills; health `getTypeColor` | Fixes colour-only status |
| `Pill`/`Chip` (version, FE/BE tag, prod, cadence, jira) | CSS `.b-tag`, `.prod-badge`, `.version-pill`, `.jira-pill` | |
| `EnvHealthDot` / `EnvCard` | page:1263-1392; health:121-192 | Merge deploy freshness + live probe |
| `QACadenceBox` | page:1306-1334 | Config-driven |
| `Modal`/`Drawer` with `role="dialog"`, Escape, focus trap, responsive width | page:1588, 1684, 1739, 1754 | Also becomes Ticket drawer |
| `Field` (label bound to input) + `DeploymentForm` | page:1591-1673 | Settings/Releases |
| `FilterBar` + `FilterChip` + `MultiSelect` (add `aria-expanded`, Escape, keyboard) | jira:460-486; page:1443-1466 | Tickets, Releases |
| `DataTable` (sticky header, pagination/virtualisation, card fallback) + `IssueTable`/`AgedTable`/`ExplorerTable` variants | jira:386-427, 490-514; page:1469-1578 | Tickets, Releases, Home |
| `StatTile` (+ optional sparkline) | page HUD 1214-1244; jira `jcard` 191-196, `LTCard` 450-458; admin HUD 535-580 | 3 duplicate implementations |
| `BarList` | jira `Bars` 369-384; admin by-env/by-status 733-817 | Insights |
| `DoraCard` | admin:608-713 (4 near-identical blocks) | Insights, Home (Mgmt) |
| `Timeline`/`WeeklyChart` (add text alternative / patterns) | page:1398-1427; jira:429-448 | Insights |
| `UserAvatar` / `AvatarStack` | page:171-251; admin avatar | Drop per-user GitHub fetch or cache |
| `PRBadgeList`, `JiraKeyChips` | page:395-471 | Ticket cards, Releases rows |
| `PromotionRadar` (`DriftRibbon` split into `useDrift` + `RadarChip` + `CommitList`) | drift:12-96 | Pipeline, Home (Rel); already isolated, replace inline CSS tokens |
| `CompareView` + `useCompare` | page:931-983, 1753-1947 | Releases |
| `ReleaseNotesPanel` | jira:271-285 | Releases |
| `Toast` (replace `alert/confirm`) and `ConfirmDialog` | 9+ call sites | Shell |
| `Skeleton`, `EmptyState`, `ErrorBanner` (with retry + "stale since") | missing everywhere | Shell |
| `lib/api.ts` fetch wrapper (checks `res.ok`, typed errors) | 15+ raw fetches | All |

### 4.4 Styling

- Move the duplicated colour constants into design tokens (CSS variables in `globals.css`) with light/dark parity; delete the first (older, light-theme) rule set in `page.tsx` (2130-2331) after confirming it is orphaned, and the mid-stylesheet `@import` (2331, ignored by browsers when not first) in favour of `next/font`.
- Known colour regressions to fix in tokens: `.btn.primary` hard-coded `#0284C7` vs coral accent elsewhere; FE and BE tags both coral (page CSS 2801, 2806).

## 5. Sequencing hints for the build

1. Extract `lib/` pure logic and shared types first (zero UI risk), fixing the bugs in 3.2 while adding tests.
2. Build `AppShell`, tokens, `StatusPill`, `Modal`, `Skeleton/Empty/Error`, `usePolling` (proposal phase 1).
3. Re-home existing sections per column "New IA home" in section 1 (phase 2), then Pipeline board using `/api/jira/deployed` + deployments (phase 3).
4. Access decision (proposal section 7) gates removing the `/jira` and `/admin` login walls; until then keep the walls but show a real read-only explanation instead of a bare login.
5. Verify against the live endpoints noted above; no API change is needed for phases 1-2.
