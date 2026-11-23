import pool from '@/lib/db';

// Deploy freeze windows: periods when an environment ("*" = every environment) should not be deployed.
// The table is created on first use (idempotent), like the webhook's approved_at column, so no manual
// migration is needed. Windows are cancelled (cancelled_at), never deleted.

let ready: Promise<void> | null = null;

export function ensureFreezeTable(): Promise<void> {
  ready ??= pool
    .query(`
      CREATE TABLE IF NOT EXISTS freeze_windows (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        environment  TEXT NOT NULL,
        starts_at    TIMESTAMPTZ NOT NULL,
        ends_at      TIMESTAMPTZ NOT NULL CHECK (ends_at > starts_at),
        reason       TEXT NOT NULL,
        created_by   TEXT,
        cancelled_at TIMESTAMPTZ,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS freeze_windows_time_idx ON freeze_windows (starts_at, ends_at);
    `)
    .then(() => undefined)
    .catch((e) => {
      ready = null; // retry on the next request
      throw e;
    });
  return ready;
}

export const MAX_FREEZE_DAYS = 14;
