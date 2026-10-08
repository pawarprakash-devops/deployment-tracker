# 04 - Access & Roles Plan (Option A: Google Workspace SSO)

Status: proposal, no code changed. Scope: replace the shared `ADMIN_TOKEN` cookie with per-user Google SSO restricted to `@vidaisolutions.com`, roles `viewer` / `admin`, Jira-accountId mapping, "my work" filtering. Parent doc: `docs/REDESIGN-PROPOSAL-ROLE-BASED-UX.md` section 7.

## 0. What was verified (and what was not)

| Fact | Source |
|------|--------|
| App is `next@16.3.3`, `react@19.2.8`, deps are only `next`, `react`, `pg` (no auth library installed) | `package.json` |
| `middleware.ts` is **deprecated in Next 16 and renamed `proxy.ts`** (export `proxy`, same behaviour; codemod `npx @next/codemod@canary middleware-to-proxy .`). Proxy defaults to the **Node.js runtime**; `runtime` config is not allowed in it | `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/middleware.md`, `proxy.md` (version history v16.0.0) |
| Next's own auth guide: Proxy runs on every route including prefetches, so only do **optimistic cookie checks** there, never database checks | `02-guides/authentication.md` ("Optimistic checks with Proxy") |
| Current auth: cookie `tracker_session` holds the **raw** `ADMIN_TOKEN` (`===` compare), 7-day, `httpOnly`, `secure` in prod, `SameSite=Lax`; no rate limit; fallbacks `admin-change-me` and `change-me-in-production` are public in the repo | `middleware.ts`, `lib/auth.ts`, `app/api/auth/route.ts`, `AUTHENTICATION.md`, `README.md` L58 |
| All `GET /api/*` are public **except** `/api/jira/*` (7 routes), `/api/admin/stats`, `GET /api/migrate`, which call `isAdminRequest` in the handler | `middleware.ts`, `app/api/jira/*/route.ts`, `lib/auth.ts` |
| `/api/webhook` bypasses the proxy and checks `Bearer WEBHOOK_SECRET` itself | `middleware.ts`, `app/api/webhook/route.ts` |
| Auth.js `next-auth@beta` = `5.0.0-beta.32`, peer `next ^14 \|\| ^15 \|\| ^16`, `react ^18 \|\| ^19`. `next-auth@latest` = `4.24.15`, peer includes `^16`. `better-auth@1.7.7` peer includes `next ^16`, needs `pg` (already present) | `npm view` registry metadata on 2026-10-08. **Nothing was installed**; real compatibility under 16.3.3 (esp. `auth()` inside `proxy.ts`) is unproven until the spike in phase 1 |

Not verified: Atlassian user-search behaviour for this site (email visibility), Google OAuth consent-screen type of the VidAI org. Both are flagged as spike items below.

## 1. Option A in one picture

```
Browser --(Google OIDC, hd=vidaisolutions.com)--> /api/sso/callback/google
   -> verify email_verified && email ends with @vidaisolutions.com (server side, not just `hd` hint)
   -> upsert app_users(email) ; role = admin if email in ADMIN_EMAILS or app_users.role='admin'
   -> encrypted JWT session cookie (email, name, role-hint, jira id)
Proxy (cheap, cookie-only): valid session | Bearer ADMIN_TOKEN | webhook path  -> allow, else 401/redirect
Route handlers (authoritative): requireViewer() / requireAdmin() -> DB-backed role + active flag (30-60 s cache)
Jira handlers: server-side redaction by role -> JSON
```

Roles are **viewer** (any signed-in `@vidaisolutions.com` user: reads everything internal, including Jira panels) and **admin** (writes: create/edit/delete deployments, environments, import, `/admin`, `/api/migrate`, user management). The **lens** (Dev / QA / Release / Mgmt) is a stored UI preference (`localStorage` + optional `app_users.default_lens`); it never changes what the API returns. Consequence stated plainly: hiding fields in the Management lens is cosmetic only (any viewer can call the API). See section 7 for how to make masking real.

## 2. Library choice

| Candidate | Fit | Verdict |
|-----------|-----|---------|
| **Auth.js v5 (`next-auth@5.0.0-beta.32`)** | Peer range covers Next 16 / React 19; App Router native (`auth()`, `handlers`); Google provider built in; stateless JWE session cookie, so no adapter or new tables needed for sessions | **Recommended**, pinned to an exact version (no `^`), because it is still a beta tag |
| Auth.js v4 (`4.24.15`) | Declares Next 16 peer, but Pages-router-era API (`getServerSession`, `withAuth`), awkward in Route Handlers and Proxy | Reject (legacy) |
| Better Auth (`1.7.7`) | Next 16 peer ok, active, role plugin; but wants its own user/session/account tables in Neon and a migration step | Fallback if the Auth.js spike fails |
| Hand-rolled OIDC (`arctic` + `jose`) | About 150 lines, no beta risk, but we own PKCE/state/nonce/cookie handling | Last resort; security-sensitive code we would rather not own |

Spike gate (half a day, phase 1, on a Vercel preview): with `next-auth@5.0.0-beta.32` pinned, confirm (a) `handlers` mount at a custom `basePath`, (b) `auth()` works in `proxy.ts` on Node runtime, (c) `next build` is clean, (d) cookie flags as designed in section 3. If any fails, switch to Better Auth. Do **not** commit the dependency before the spike passes.

**Route collision to avoid:** Auth.js defaults to `basePath: /api/auth` with a catch-all, but this repo already owns `app/api/auth/route.ts` and `app/api/auth/session/route.ts` (the UI calls `/api/auth/session`). Static segments win over the catch-all, so Auth.js's own `/api/auth/session` would be shadowed and break. Set `basePath: '/api/sso'` (`app/api/sso/[...nextauth]/route.ts`). Keep `/api/auth*` as the legacy/break-glass surface and extend `GET /api/auth/session` to return `{authenticated, role, email, jiraAccountId, via: 'sso'|'breakglass'|null}` (backward compatible: `authenticated` + `role` keep their meaning).

## 3. Session and cookie design

- **Strategy:** Auth.js JWT (encrypted JWE with `AUTH_SECRET`), no DB sessions. Payload: `sub` (Google id), `email` (lowercased), `name`, `role` (hint), `jira` (accountId or null), `rv` (role-verified-at).
- **Cookie:** `__Secure-authjs.session-token` (Auth.js default in prod; consider `__Host-` prefix via `cookies` option: requires `Path=/`, no `Domain`, `Secure`). Flags: `HttpOnly`, `Secure`, `SameSite=Lax` (Lax is required for the Google redirect back; Strict would drop the session on the OAuth return). No tokens from Google are stored (we only need identity): do not persist `access_token` / `refresh_token` in the JWT.
- **Lifetime:** `maxAge` 12 h absolute-ish (workday), `updateAge` 1 h; admin hint re-verified against the DB every 10 min inside the `jwt` callback (sets `rv`); handlers do the authoritative check. Down from today's 7-day, non-revocable raw-token cookie.
- **Role is not trusted from the cookie for writes.** Proxy treats `role` as an optimistic hint (fast 401 for obvious viewers on writes); every mutating route handler calls `requireAdmin()` which reads `app_users` (cached 30-60 s per instance). This also gives revocation: setting `active=false` or `role='viewer'` takes effect within about a minute even though the JWT lives up to 12 h.
- **Offboarding:** Google suspension stops new logins only. Mitigations: 12 h max session, `active` flag check, and `ADMIN_EMAILS` removal + redeploy as emergency path.
- **Break-glass session:** separate cookie `tracker_bg` (signed JWT via `jose`, `sub=breakglass`, role admin, 1 h, `__Host-` prefix, `HttpOnly`, `Secure`, `Lax`), issued by `POST /api/auth` after the existing password check. It replaces the raw-token cookie. Legacy `tracker_session=<raw token>` is accepted only while `AUTH_MODE` is `legacy` or `dual` (section 5).

## 4. Proxy changes (`middleware.ts` becomes `proxy.ts`)

Rename the file and the export (`export function proxy(request)`), via the codemod; keep `config.matcher`. Matcher widens from `/api/:path*` to also cover pages once login gating of pages starts (phase 3):

```
matcher: ['/api/:path*', '/((?!_next/static|_next/image|favicon.ico|login|public).*)']
```

Decision order (first match wins), compared with today:

| # | Rule | Today | New |
|---|------|-------|-----|
| 1 | `/api/webhook` | pass through | **unchanged** (route checks `WEBHOOK_SECRET`). No CSRF/Origin check here: it is a server-to-server Bearer call |
| 2 | `/api/health` | public GET | unchanged public (uptime probes) |
| 3 | `/api/sso/*`, `/api/auth*`, `/login` | pass through | pass through (Auth.js enforces its own CSRF/state; break-glass has its own limiter) |
| 4 | `Authorization: Bearer ADMIN_TOKEN` | admin | **unchanged**, kept as break-glass for scripts/CI. Timing-safe compare; fail closed if `ADMIN_TOKEN` unset in production |
| 5 | Valid SSO session cookie (decode only, no DB) | n/a | GET: allow (viewer or admin). Mutating: require `role` hint `admin`, else 403 |
| 6 | Valid break-glass cookie, or legacy raw cookie (only while `AUTH_MODE != sso`) | admin | admin |
| 7 | Mutating method, no credentials | 401 | 401 |
| 8 | Mutating method with cookie auth | no origin check | **require `Origin` (or `Referer`) host == request host**, and `Content-Type: application/json` for bodies; Bearer callers exempt |
| 9 | GET without credentials | public | phase 1-2: unchanged public (except Jira/admin routes now accept viewer SSO); phase 3: 401 for `/api/*` (API) or redirect to `/login?callbackUrl=` (pages) |

Handler-level (not proxy) work:
- `lib/auth.ts` gains `getPrincipal(request)` -> `{email, role, via, jiraAccountId} | null`, `requireViewer()`, `requireAdmin()`. `isAdminRequest` stays as a thin wrapper (`principal?.role === 'admin'`) so the seven Jira routes, `admin/stats` and `migrate` do not change shape; Jira routes switch to `requireViewer()` (the change that delivers the product goal).
- **Forgotten-guard risk:** moving the admin decision partly into handlers means a new write route without `requireAdmin()` would be writable by any viewer. Add a repo test that globs `app/api/**/route.ts`, finds exports `POST|PUT|PATCH|DELETE`, and fails unless the file calls `requireAdmin` (or is on an explicit allowlist: `webhook`, `auth`, `sso`).

## 5. Migration path (ADMIN_TOKEN kept as break-glass, webhook untouched)

Feature flag env `AUTH_MODE`: `legacy` (today) -> `dual` (SSO + legacy both accepted) -> `sso` (SSO + break-glass only; raw-token cookie rejected).

| Phase | Change | Visible to users |
|-------|--------|------------------|
| 0 (immediate, independent, 1 PR) | Remove the hardcoded fallbacks: if `ADMIN_TOKEN` or `WEBHOOK_SECRET` is unset in production, deny (fail closed). Timing-safe compare. **Before merge, confirm in Vercel (`vercel env ls`) that both are set to non-default values; do not probe production with the defaults.** If the repo is or was ever public, treat both defaults as compromised and rotate `ADMIN_TOKEN` (cookie holds it raw). Rotating `WEBHOOK_SECRET` is **out of scope** (CI secret `TRACKER_WEBHOOK_SECRET` must match); only the unset-default is removed | none |
| 1 | `npm i next-auth@5.0.0-beta.32 --save-exact` (spike gate, section 2); rename `middleware.ts` -> `proxy.ts`; add `app_users`, `auth_audit` tables (additive migration); `AUTH_MODE=legacy`, SSO code present but dark | none |
| 2 | `AUTH_MODE=dual`: `/login` page with "Sign in with Google" and a small "Admin password" link (break-glass). Jira routes accept viewer SSO. Admin keeps working with the old password during this phase | Everyone can sign in; Jira panels light up for viewers |
| 3 | Add `GET /api/me`, Jira accountId mapping, "my work"; require login for pages and GETs (rule 9) | Login wall |
| 4 | Soak 2 weeks, then `AUTH_MODE=sso`: legacy raw cookie stops working, `ADMIN_TOKEN` remains only as Bearer + break-glass form (1 h signed cookie, rate-limited, audited) | Admins use their Google identity |
| 5 | Remove legacy code paths, update `AUTHENTICATION.md` and README | none |

**Rollback:** each phase is one deploy. Fast path: Vercel "Instant Rollback" to the previous deployment (seconds, no rebuild). Config path: set `AUTH_MODE=legacy` and redeploy. DB changes are additive only (new tables, no column changes to `deployments`/`environments`), so no data rollback is needed. Never delete `ADMIN_TOKEN` or the Bearer path; they are the lockout recovery if Google/Auth.js breaks.

**Webhook invariant:** `app/api/webhook/route.ts`, the `/api/webhook` proxy exemption, and the `WEBHOOK_SECRET` value are not modified in any phase. Add a regression test (section 9).

## 6. Where the admin list lives

| | Env var `ADMIN_EMAILS` (comma list) | DB table `app_users` |
|---|---|---|
| Change cost | Vercel env edit + redeploy | Instant, via a Settings screen (admin only) |
| Audit trail | Vercel audit log only | `auth_audit` rows (who promoted whom) |
| Failure mode | None (no DB dependency at login) | Neon outage -> cannot resolve role |
| Fit for 5-15 admins | Fine | Fine, better UX |

**Recommendation: both.** `ADMIN_EMAILS` is the bootstrap/immutable floor: those emails are always admin, cannot be demoted from the UI, and keep working if Neon is down (break-glass for humans). `app_users` holds day-to-day admins and viewers and the Jira mapping. Effective role = `admin` if email in `ADMIN_EMAILS` else `app_users.role` (default `viewer`).

```sql
CREATE TABLE app_users (
  email           text PRIMARY KEY CHECK (email = lower(email)),
  role            text NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer','admin')),
  jira_account_id text,
  jira_map_source text CHECK (jira_map_source IN ('email','name','manual')),
  display_name    text,
  default_lens    text,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_login_at   timestamptz,
  updated_by      text
);
CREATE TABLE auth_audit (
  id bigserial PRIMARY KEY, ts timestamptz NOT NULL DEFAULT now(),
  email text, event text NOT NULL, ip text, ua text, detail jsonb
);  -- events: login, login_denied, role_change, breakglass_ok, breakglass_fail, logout
CREATE TABLE login_attempts (ip text, bucket timestamptz, n int, PRIMARY KEY (ip, bucket));
```

Viewers are auto-provisioned on first successful login (any verified `@vidaisolutions.com`); no pre-registration needed. Last-admin protection: refuse to demote the final DB admin when `ADMIN_EMAILS` is empty.

## 7. Jira identity mapping and "my work"

1. On first login (and when `jira_account_id` is null), call Jira `GET /rest/api/3/user/search?query=<email>` using the existing `jiraFetch` credentials. Take a single exact email match, store `jira_account_id` with `jira_map_source='email'`. **Spike item:** Atlassian profile-privacy settings can hide `emailAddress`, and the API-token owner needs "Browse users and groups"; if email search returns nothing, fall back to (2).
2. Fallback: match `display_name` (from Google) against the existing `people` list in `/api/jira/filters` (already `{id, name}`) when exactly one candidate matches (`jira_map_source='name'`).
3. Otherwise show a one-time "Which Jira user are you?" picker (uses the same `people` list); store as `manual`. Admins can edit any mapping in Settings. Mis-mapping is low-impact because all viewers can read everything anyway; it only changes the default filter.
4. `GET /api/me` returns `{email, name, role, jiraAccountId, defaultLens}`. "My work" = existing `filterJql` with `assignee=<accountId>` injected **server-side from the principal** (`?mine=1`); the client never supplies its own accountId for this, and `jqlStr` quoting stays on the path so nothing from the session reaches JQL unescaped.

## 8. Jira panels: data-exposure review

All seven Jira routes return internal ticket data. Today only an admin sees it; Option A widens it to every signed-in employee. Fields returned by `toIssue` (`lib/jira.ts`) and per-route exposure:

| Route | Sensitive content | Viewer (SSO) | Management lens / `stakeholder` |
|-------|-------------------|--------------|----------------------------------|
| `issues`, `search`, `deployed` | `summary` (may contain customer or incident detail), `assignee`, `reporter` (display names), `labels`, `components`, `fixVersions`, `url` (reveals Atlassian site host) | Full | Drop `assignee`, `reporter`; keep key, type, status, priority, counts. Truncate/omit `summary` if question 3 of the redesign doc is "yes, non-engineers" |
| `stats` | `byAssignee` (per-person open-ticket counts, from a 500-issue sample), sprint names | Full | Replace `byAssignee` with team/component aggregates; per-person workload is effectively a performance ranking |
| `insights` | stuck tickets list with titles and assignees | Full | Counts only, no titles/assignees |
| `filters` | `people`: **every assignable Jira user's accountId and name**, plus labels/versions | Only the viewer's own entry + names needed for filter chips; omit accountIds for others if the picker is not needed | Omit `people` entirely |
| `release-notes` | ticket keys, titles, statuses for a deployment | Full | Titles only for tickets of type Story/Bug, no assignees (already none) |
| `GET /api/admin/stats` | DORA, `top operators` (named people), incidents | Admin only (unchanged) | n/a |
| Public GETs today (`deployments`, `environments`, `drift`, `cluster-health`, `compare`) | `requested_by`, `approved_by`, `tested_by`, `deployed_by`, `ticket_link`, notes | Public today; goes behind login in phase 3 | Keep names (they are release-governance fields) |

**Making masking real.** Because lens is a UI preference, per-lens masking is cosmetic. Recommended: ship phase 3 with **no server masking** (all `@vidaisolutions.com` staff are trusted with internal Jira, which they can already read in Jira itself if project permissions are open). If the answer to redesign Q3 is "non-engineers will see the Management view with names hidden", add a third attribute rather than reusing the lens: `app_users.role = 'stakeholder'` (read-only, server applies `redactIssue()` / `redactStats()` in one `lib/redact.ts` used by every Jira route, driven by principal role). That is a small additive change (extend the CHECK constraint) and keeps one choke point. Also: Jira API token scope is the app's service account, so the app can return tickets a given employee cannot see in Jira (privilege broadening). Mitigation: restrict `JIRA_PROJECT_KEYS` to projects open to all staff; never expose security-level-restricted projects. Keep `fresh=1` cache-bypass admin-only (protects Jira rate limits).

## 9. Security checklist

| Area | Control |
|------|---------|
| **Domain restriction** | `hd=vidaisolutions.com` is only a UI hint. Enforce in the Auth.js `signIn` callback: `profile.email_verified === true` AND `email` lowercased ends with `@vidaisolutions.com` AND ID-token `hd === 'vidaisolutions.com'`. Set the Google OAuth consent screen to **Internal** (Workspace-only) so outsiders are blocked at Google too. Reject on any mismatch and log `login_denied` |
| **Account takeover via email reuse** | Key identity on verified email + Google `sub`; do not link by unverified email |
| **CSRF** | Cookies are `SameSite=Lax`, so cross-site POSTs do not carry them; add the Origin/Referer host check on mutating cookie-authenticated requests (proxy rule 8) and require JSON content type; no state-changing GETs (logout = POST); Auth.js provides CSRF token + `state`/PKCE for its own endpoints; Bearer calls are not cookie-borne and are exempt |
| **Cookie flags** | `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain`, `__Secure-`/`__Host-` prefix; short `maxAge`; no tokens or role secrets in readable storage |
| **Open redirect** | Sanitise `callbackUrl`/`redirect` to same-origin relative paths: must start with a single `/`, reject `//`, `\`, `/\`, control chars, and any scheme; implement Auth.js `redirect` callback accordingly; unit-test the bypass strings |
| **Rate limiting** | Break-glass `POST /api/auth`: Vercel Firewall rate-limit rule (e.g. 5 req/min/IP on the path) as the outer layer, plus the `login_attempts` table (serverless memory is per-instance, so a DB counter is the reliable fallback) with exponential backoff and `breakglass_fail` audit rows; always constant-time compare; identical error for wrong password and locked-out. Also rate-limit `/api/jira/*` per principal to protect the Atlassian quota (responses are already cached 5 min) |
| **Publicly known default secrets** | `admin-change-me` and `change-me-in-production` are in the repo and README. Phase 0 removes the fallbacks (fail closed), verifies the live values are not defaults, rotates `ADMIN_TOKEN`; adds a startup assertion (`AUTH_SECRET` >= 32 random bytes, `ADMIN_TOKEN` != known defaults). Webhook secret value is left as is (CI coupling) but its default is removed |
| **Secrets hygiene** | New env vars only in Vercel (`AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `ADMIN_EMAILS`, `AUTH_MODE`); separate values for Preview vs Production; never log them; `AUTH_SECRET` rotation invalidates all sessions (acceptable) |
| **Vercel previews** | Google does not allow wildcard redirect URIs and preview URLs are random. SSO is configured for the production domain plus one stable alias (e.g. a `staging` branch domain). Other previews use `AUTH_MODE=legacy`/break-glass only. Set `AUTH_TRUST_HOST`/`trustHost` only for known hosts |
| **Session fixation / logout** | Auth.js rotates the session on sign-in; logout clears cookie; break-glass logout clears `tracker_bg` |
| **Authorization at the data layer** | `requireAdmin()` on every mutating handler (+ repo test, section 4); `/api/migrate` and `/api/admin/stats` stay admin; SQL stays parameterised (existing); JQL values go through `jqlStr` |
| **Audit** | `auth_audit` rows for login, denial, role change, break-glass use; admin-visible list; alert (existing `lib/alerts.ts` GChat webhook) on any `breakglass_ok` |
| **Headers** | Add `Content-Security-Policy` (no inline script from untrusted origins), `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, `X-Content-Type-Options: nosniff` in `next.config.ts` headers |

## 10. Rollout steps (condensed run-sheet)

1. Phase 0 PR (fail-closed secrets, timing-safe compare, rotate `ADMIN_TOKEN`). Deploy. Verify CI webhook still posts (check a deployment row appears).
2. Create Google OAuth client (Internal consent screen), redirect URI `https://vidai-deployments.vercel.app/api/sso/callback/google` (+ staging alias). Add env vars in Preview first.
3. Phase 1 on a preview: dependency spike, proxy rename, tables migration, `AUTH_MODE=legacy`. Merge when spike gate passes.
4. Phase 2: `AUTH_MODE=dual` in production; seed `ADMIN_EMAILS` with 2+ people; each admin signs in once and confirms admin buttons; Jira panels checked as a plain viewer from a non-admin account.
5. Phase 3: login wall + `/api/me` + "my work"; announce in the team channel.
6. Soak 2 weeks (watch `auth_audit`, Vercel logs for 401/403 spikes), then `AUTH_MODE=sso`.
7. Clean-up PR and docs update.
Rollback at any step: Instant Rollback, or `AUTH_MODE=legacy`; break-glass Bearer is always available.

## 11. Test plan

Unit (add `vitest` or `node:test`; repo has none today, so adding a test runner is itself a prerequisite):
- Domain check: accepts `a@vidaisolutions.com`; rejects `a@gmail.com`, `a@vidaisolutions.com.evil.com`, `a@evil.com+vidaisolutions.com`, unverified email, `hd` mismatch, mixed-case email normalised.
- `sanitizeCallback`: allows `/jira?x=1`; rejects `//evil.com`, `/\evil.com`, `https://evil.com`, `javascript:`, encoded variants.
- `getPrincipal` / role resolution: env admin wins; DB admin; `active=false` denied; DB down -> env admins still admin, others viewer-read-only, writes fail closed.
- Origin check: same-origin POST ok; cross-origin and missing-origin cookie POST 403; Bearer POST ok.
- Redaction (`redactIssue`, `redactStats`) for stakeholder role, if built.

Route authorisation matrix (table-driven, hits each `app/api/**/route.ts` handler with: anonymous, viewer cookie, admin cookie, Bearer ADMIN_TOKEN, break-glass cookie, legacy cookie in each `AUTH_MODE`, webhook secret). Includes the guard test that every mutating export calls `requireAdmin`.

Integration / E2E (sessions minted with Auth.js `encode` and the test `AUTH_SECRET`, never a real Google login in CI):
- Viewer: Jira panels render, admin buttons absent, POST `/api/deployments` returns 403.
- Admin: write succeeds; demote to viewer in DB -> write rejected within 60 s.
- Expired/forged/tampered cookie -> 401. Cookie from a different `AUTH_SECRET` -> 401.
- `/api/webhook` regression: valid `WEBHOOK_SECRET` -> 201, wrong -> 401, no session needed, in every `AUTH_MODE`.
- Break-glass: correct password -> 1 h cookie and `breakglass_ok` audit + alert; 6 wrong attempts -> locked, correct password also refused until backoff ends.
- Mapping: email hit, name fallback, manual picker, `?mine=1` injects the stored accountId and ignores a client-supplied one.

Manual (preview, then prod): sign in with a non-company Google account (denied), suspended user (denied after session expiry), logout in tab A reflected in tab B on next request, cookie flags in DevTools, Lighthouse/headers check, mobile Safari OAuth return (Lax cookie survives redirect).

## 12. Options B and C (for the record)

| | B. Keep shared admin password, lens is layout only | C. Make Jira panels public read |
|---|---|---|
| Work | None | One-line change per route (drop `isAdminRequest`) |
| Identity / "my work" | No; user picks a name from a dropdown (stored in `localStorage`) | No, same |
| Jira visibility | Still admin-only; non-admins see no Jira data, so lenses for Dev/QA/Mgmt are mostly empty | Everyone, including the public internet |
| Risk | Shared password with raw-token cookie, no audit, no per-person revocation (the problems documented in `AUTHENTICATION.md`) stay | Internal ticket titles, assignees, workload exposed on a public Vercel URL. **Not recommended**; at minimum would need field redaction and still leaks internals |
| Verdict | Acceptable only as a stop-gap; does not meet the redesign goal | Reject |

Other lighter alternatives (not evaluated against this account's plan, so unverified): Vercel deployment protection (limited to Vercel team members rather than Google Workspace), or fronting the app with an identity-aware proxy (Cloudflare Access / Google IAP). They avoid app code but add a vendor and do not give the app a per-user identity for "my work" unless it also reads the forwarded identity header. Option A stays the recommendation because it delivers identity for "my work" and revocable per-user roles with the smallest new dependency set (one library, two small tables).

## 13. Open decisions needed from the owner

1. Approve Option A and the Auth.js v5 beta (pinned) with Better Auth as fallback.
2. Admin bootstrap list for `ADMIN_EMAILS` (at least two people).
3. Is Google OAuth consent screen creation allowed as **Internal** in the VidAI Workspace?
4. Management view audience: staff-only (no server masking) or includes people who should not see names (then add the `stakeholder` role)?
5. Should the whole site (not just Jira) go behind login in phase 3, or stay public-read for deployments?
6. Confirm the current live `ADMIN_TOKEN` / `WEBHOOK_SECRET` are non-default (owner check in Vercel, not a network probe).
