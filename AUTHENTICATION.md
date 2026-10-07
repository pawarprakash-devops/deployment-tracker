# Authentication & Admin Access

Implemented in `middleware.ts` (matcher `/api/:path*`), `app/api/auth/route.ts` and `app/api/auth/session/route.ts`.

## Access model

| Who | Can do |
|-----|--------|
| Anyone (no login) | View `/`, `/health`; every `GET /api/*`; export JSON |
| Admin | Everything above plus the `/admin` telemetry page and create/edit/delete deployments, manage environments, import JSON |
| CI (`vidai-devops` workflows) | `POST /api/webhook` only, using the **webhook secret** (separate from the admin token) |

Rules enforced by the middleware, in order:
1. `/api/webhook` → passes through (the route checks `Authorization: Bearer <WEBHOOK_SECRET>` itself).
2. `/api/auth*` → always allowed.
3. Any `GET` → allowed.
4. `POST` / `PUT` / `PATCH` / `DELETE` → require `Authorization: Bearer <ADMIN_TOKEN>` **or** a `tracker_session` cookie equal to `ADMIN_TOKEN`; otherwise `401 Unauthorized - Admin login required to make changes`.

> `/admin` shows a login challenge until `GET /api/auth/session` reports `admin` — but this is a **client-side gate only**: the data it renders comes from the public `GET /api/admin/stats`, which is not authenticated.
>
> `GET /api/migrate` is a `GET`, so it is reachable without auth even though it mutates data (the POST variant is protected). Treat it as a known gap.

## Login flow

- `POST /api/auth` with `{"password": "<ADMIN_TOKEN>"}` → sets cookie `tracker_session` (`httpOnly`, `secure` in production, `SameSite=Lax`, 7 days, path `/`).
- `DELETE /api/auth` → clears the cookie (logout).
- `GET /api/auth/session` → `{authenticated, role}` where role is `viewer` or `admin`.
- The main dashboard shows admin buttons (Manage Environments, Import JSON, New Deployment, per-row Edit/Delete, Admin Dashboard link, Logout) only when the session is admin; viewers see Export JSON and an Admin Login button.

## Secrets (set in Vercel project env vars, never in git)

| Variable | Purpose | Default if unset |
|----------|---------|------------------|
| `ADMIN_TOKEN` | Admin password and session cookie value | `admin-change-me` (public in this repo — **must be set**) |
| `WEBHOOK_SECRET` | Shared secret for `POST /api/webhook` (GitHub secret `TRACKER_WEBHOOK_SECRET` must match) | `change-me-in-production` (public in this repo — **must be set**) |

Rotate a value:

```bash
vercel env rm ADMIN_TOKEN production
vercel env add ADMIN_TOKEN production
# then redeploy (push to main, or run the "Deploy to Vercel" workflow)
```

Known limitations of the current design (not yet addressed in code): the session cookie holds the raw admin token rather than a signed session id, there is one shared admin password (no per-user identity), and there is no login rate limiting.

## Testing

```bash
BASE=https://vidai-deployments.vercel.app

# viewer role
curl $BASE/api/auth/session

# write without auth -> 401
curl -X POST $BASE/api/deployments -H "Content-Type: application/json" -d '{"environment":"QA"}'

# login (read the password from your secret store; do not paste it into shared logs)
curl -X POST $BASE/api/auth -H "Content-Type: application/json" \
  -d "{\"password\":\"$ADMIN_TOKEN\"}" -c cookies.txt

# write with session -> 201
curl -X POST $BASE/api/deployments -H "Content-Type: application/json" -b cookies.txt \
  -d '{"environment":"QA","status":"Success","started_at":"2026-08-27T12:00:00Z"}'
```

## `/admin` dashboard contents

DORA suite (deployment frequency, lead time, change failure rate — fleet and production-only — and MTTR with Elite/High/Medium/Low ratings), plus: deployments by target environment, pipeline execution status, recent critical failures, longest pipeline runs, top operators, and the incident recovery & MTTR audit trail (failure → next success on the same environment, with links to both runs). See `docs/ROADMAP.md` §3.3.
