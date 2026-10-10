import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { notifyDeployment } from '@/lib/alerts';

// Open (non-final) statuses, lowest to highest rank. A post may only move a row UP this ladder; a lower or equal
// post never downgrades it (e.g. a late 'Awaiting approval' must not overwrite 'In Progress').
const OPEN_LADDER = ['Awaiting approval', 'Queued', 'In Progress'] as const;
const OPEN_SQL = `'^(rerun - )?(awaiting approval|queued|in progress)$'`;
const openRank = (s: string) => OPEN_LADDER.findIndex((l) => s.trim().toLowerCase().replace(/^rerun - /, '') === l.toLowerCase());

// approved_at (nullable, additive) is when a gated run left 'Awaiting approval'. Duration starts there. Neon needs no
// manual migration before this deploys: the column is added once per server instance, idempotently (also in /api/migrate).
let approvedAtReady: Promise<void> | null = null;
function ensureApprovedAtColumn(): Promise<void> {
  approvedAtReady ??= pool
    .query('ALTER TABLE deployments ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ')
    .then(() => undefined)
    .catch((e) => { approvedAtReady = null; throw e; });
  return approvedAtReady;
}

export async function POST(request: NextRequest) {
  try {
    // Verify authorization (simple token-based auth)
    const authHeader = request.headers.get('authorization');
    const expectedToken = process.env.WEBHOOK_SECRET || 'change-me-in-production';
    
    if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    
    // Extract deployment info from webhook payload
    const {
      environment,
      status: rawStatus,
      deployment_type = 'standard',
      branch,
      version,
      frontend_branch,
      backend_branch,
      frontend_version,
      backend_version,
      requested_by,
      approved_by,
      tested_by,
      deployed_by,
      ticket_link,
      notes,
      started_at,
      completed_at,
      duration_seconds,
    } = body;

    // Validate required fields
    if (!environment || !rawStatus) {
      return NextResponse.json(
        { error: 'Missing required fields: environment, status' },
        { status: 400 }
      );
    }
    // Canonical labels for the open statuses and 'Rejected' (matched case-insensitively on input).
    const status: string = OPEN_LADDER.find((l) => l.toLowerCase() === String(rawStatus).trim().toLowerCase())
      ?? (/^\s*rejected\s*$/i.test(rawStatus) ? 'Rejected' : rawStatus);
    const deployStartedAt = started_at || new Date().toISOString();

    // Auto-normalize environment & cluster name
    function normalizeEnvironment(
      rawEnv?: string,
      noteText?: string,
      branchName?: string,
      feBranch?: string,
      beBranch?: string
    ): { name: string; isProduction: boolean } {
      const combined = `${rawEnv || ''} ${noteText || ''} ${branchName || ''} ${feBranch || ''} ${beBranch || ''}`.toLowerCase();
      const envOnly = (rawEnv || '').toLowerCase();
      // US-West: `preprod_usw` / `pre-prod-usw` CONTAIN `prod_usw` / `prod-usw`, so the Production USW pattern
      // refuses a preceding `pre` / `pre-` / `pre_` / `pre ` (lookbehind). Matches "Production USW", production-usw,
      // production-usw-ecs-cluster, prod-usw, prod_usw. Separators include a space because the deploy workflows post
      // labels like "Pre-Prod USW". The raw environment decides first, so a promotion note such as
      // "preprod_usw -> prod_usw" or a stray "preview"/"demo" in notes cannot override the cluster that was deployed.
      const PROD_USW_RE = /production[-_ ]usw|(?<!pre[-_ ]?)prod[-_ ]usw/;
      const PREPROD_USW_RE = /pre-?prod[-_ ]usw/;
      if (PROD_USW_RE.test(envOnly)) {
        return { name: 'Production USW', isProduction: true };
      }
      if (PREPROD_USW_RE.test(envOnly)) {
        return { name: 'Pre-Prod USW', isProduction: false };
      }

      if (/staging-euw2|stage-euw2|euw2/.test(combined)) {
        return { name: 'Stage EUW2', isProduction: false };
      }
      if (/staging-use1|stage-use1|use1/.test(combined)) {
        return { name: 'Stage USE1', isProduction: false };
      }
      // Demo-Preview (preview.vidaisolutions.com) — check BEFORE QA because PR titles
      // like "QA to Demo" would otherwise match the QA regex below.
      if (/\bdemo\b/.test(combined) || /preview-ecs-cluster|demo-preview/.test(combined)) {
        return { name: 'Demo-Preview', isProduction: false };
      }
      if (/preview-99999|preview/.test(combined) && !/stage|pre-prod|preprod/.test((rawEnv || '').toLowerCase())) {
        return { name: 'Preview', isProduction: false };
      }
      // Use word-boundary or explicit cluster prefix to avoid matching "qa" in
      // PR titles like "QA to Demo" or notes text.
      if (/qa-aps|\bqa\b/.test((rawEnv || '').toLowerCase()) || /qa-aps-ecs-cluster/.test(combined)) {
        return { name: 'QA', isProduction: false };
      }
      // Production USW BEFORE Pre-Prod USW and the generic pre-prod / production rules (see PROD_USW_RE above).
      if (PROD_USW_RE.test(combined)) {
        return { name: 'Production USW', isProduction: true };
      }
      if (PREPROD_USW_RE.test(combined)) {
        return { name: 'Pre-Prod USW', isProduction: false };
      }
      if (/pre-prod|preprod/.test(combined)) {
        return { name: 'Pre-Prod', isProduction: false };
      }
      if (/prod-ank|prod_ank|ankura/.test(combined)) {
        return { name: 'Production (Ankura)', isProduction: true };
      }
      if (/prod-neo|prod_neo|neotia|babyjoy/.test(combined)) {
        return { name: 'Production (Neotia/Babyjoy)', isProduction: true };
      }
      if (/prod-refera|refera/.test(combined)) {
        return { name: 'Production (Refera)', isProduction: true };
      }
      if (/production|prod/.test(combined) && !/pre-prod|preprod/.test(combined)) {
        return { name: 'Production', isProduction: true };
      }
      if (/stage|staging/.test(combined)) {
        return { name: 'Stage', isProduction: false };
      }
      if (/lms/.test(combined)) {
        return { name: 'LMS', isProduction: false };
      }

      if (rawEnv && rawEnv !== 'Other') {
        const cleaned = rawEnv.replace(/[-_]ecs.*$/i, '').replace(/[-_]cluster$/i, '');
        const isProd = /prod/i.test(rawEnv) && !/pre-prod|preprod/i.test(rawEnv);
        return { name: cleaned, isProduction: isProd };
      }

      return { name: 'Demo-Preview', isProduction: false };
    }

    const resolved = normalizeEnvironment(
      environment,
      notes,
      branch,
      frontend_branch,
      backend_branch
    );
    const targetEnv = resolved.name;
    const isProdEnv = resolved.isProduction;

    // Auto-create environment if it doesn't exist
    const envCheck = await pool.query(
      'SELECT id FROM environments WHERE name = $1',
      [targetEnv]
    );

    if (envCheck.rows.length === 0) {
      const maxOrder = await pool.query(
        'SELECT COALESCE(MAX(display_order), 0) + 1 as next_order FROM environments'
      );
      const nextOrder = maxOrder.rows[0].next_order;
      
      await pool.query(
        `INSERT INTO environments (name, is_production, display_order) 
         VALUES ($1, $2, $3)`,
        [targetEnv, isProdEnv, nextOrder]
      );
      console.log(`✅ Auto-created environment: ${targetEnv} (is_production: ${isProdEnv})`);
    }

    const isInProgressStatus = /^\s*in progress\s*$/i.test(status);
    // 'Queued' = waiting in the FIFO deploy lane behind an earlier run. It is an OPEN (non-final)
    // status exactly like 'In Progress': it can be upgraded to In Progress or finalised in place.
    const isQueuedStatus = /^\s*queued\s*$/i.test(status);
    // 'Awaiting approval' = the run is paused on a GitHub Environment approval. OPEN, lowest rank: it holds no FIFO
    // lane and never counts as running; duration only starts once it is approved.
    const isAwaitingStatus = status === 'Awaiting approval';
    const isOpenStatus = isInProgressStatus || isQueuedStatus || isAwaitingStatus;
    const incomingRank = openRank(status);

    // Duration is only meaningful for a finished deployment. An open ('Queued' / 'In Progress')
    // post never carries completed_at / duration (any that are sent are ignored).
    const effectiveCompletedAt = isOpenStatus ? null : completed_at || null;
    let calculatedDuration = isOpenStatus ? null : duration_seconds;
    if (effectiveCompletedAt && !duration_seconds) {
      const startTime = new Date(deployStartedAt).getTime();
      const endTime = new Date(effectiveCompletedAt).getTime();
      calculatedDuration = Math.round((endTime - startTime) / 1000);
    }

    // Non-empty payload value, else null (used with COALESCE to keep the stored value on updates)
    const nz = (v: unknown) => (v === undefined || v === null || v === '' ? null : v);

    // Alerts are only ever sent for a FINAL outcome (never for 'Queued' / 'In Progress' or their 'Rerun - ' forms).
    // Shared by the insert path and the in-place update path so both behave identically.
    const alertIfFinal = async (row: { status: string } & Parameters<typeof notifyDeployment>[0]) => {
      if (/(in progress|queued|awaiting approval)$/i.test(row.status)) return;
      await notifyDeployment(row, alertIsProd);
    };

    await ensureApprovedAtColumn();
    const client = await pool.connect();
    let result;
    let updated = false;
    let alertIsProd = isProdEnv;
    let alertEnv: string | null = null;
    try {
      await client.query('BEGIN');

      if (ticket_link) {
        // Serialise concurrent posts for the same workflow run + environment
        // (e.g. two near-simultaneous 'In Progress' posts) — released at COMMIT/ROLLBACK.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${ticket_link}|${targetEnv}`]);

        // Newest open ('Awaiting approval' / 'Queued' / 'In Progress' and 'Rerun - ' forms) row for this run + environment
        const open = await client.query(
          `SELECT * FROM deployments
           WHERE ticket_link = $1 AND environment = $2 AND status ~* ${OPEN_SQL}
           ORDER BY created_at DESC LIMIT 1
           FOR UPDATE`,
          [ticket_link, targetEnv]
        );

        let openRow = open.rows[0];
        if (!openRow && !isOpenStatus) {
          // Fallback: environment normalisation also reads notes/branches, so POST 1 and POST 2 can
          // resolve to different names. If EXACTLY ONE in-progress row exists for this run URL
          // (any environment), it is that run's row. Zero or several => legacy behaviour.
          const anyEnv = await client.query(
            `SELECT * FROM deployments
             WHERE ticket_link = $1 AND status ~* ${OPEN_SQL}
             ORDER BY created_at DESC LIMIT 2
             FOR UPDATE`,
            [ticket_link]
          );
          if (anyEnv.rows.length === 1) {
            openRow = anyEnv.rows[0];
            console.warn('⚠️ Environment differs between in-progress row and final post; updating the row in place:', {
              ticket_link, rowEnvironment: openRow.environment, incomingEnvironment: targetEnv,
            });
            // Alerts follow the row's environment (what the dashboard shows)
            const envRow = await client.query('SELECT is_production FROM environments WHERE name = $1', [openRow.environment]);
            alertEnv = openRow.environment;
            alertIsProd = envRow.rows[0] ? !!envRow.rows[0].is_production : /prod/i.test(openRow.environment) && !/pre-prod|preprod/i.test(openRow.environment);
          }
        }

        if (openRow) {
          const row = openRow;
          const isRerunRow = /^rerun - /i.test(row.status);
          const noteText = notes ? (isRerunRow ? `🔄 Rerun: ${notes}` : notes) : null;

          if (isOpenStatus) {
            // Duplicate / transitional open post: idempotent — refresh the existing row, no new row, no alert.
            // Ladder: Awaiting approval -> Queued -> In Progress. A post only moves the row UP; a lower or equal
            // post never downgrades it (e.g. the 2nd lane of a both-component deploy posts Queued after the 1st
            // lane is running, or a late 'Awaiting approval' arrives after the run started).
            const rowRank = openRank(row.status);
            const upgrade = incomingRank > rowRank;
            const nextStatus = upgrade ? (isRerunRow ? `Rerun - ${status}` : status) : row.status;
            // Leaving 'Awaiting approval' = approval time: duration is measured from here, not from row creation.
            const approvedNow = upgrade && rowRank === 0;
            result = await client.query(
              `UPDATE deployments SET
                 status = $13,
                 approved_at = CASE WHEN $14::boolean THEN COALESCE(approved_at, NOW()) ELSE approved_at END,
                 approved_by = COALESCE($15, approved_by),
                 notes = COALESCE($2, notes),
                 started_at = COALESCE(started_at, $3),
                 deployment_type = COALESCE($4, deployment_type),
                 branch = COALESCE($5, branch), version = COALESCE($6, version),
                 frontend_branch = COALESCE($7, frontend_branch), backend_branch = COALESCE($8, backend_branch),
                 frontend_version = COALESCE($9, frontend_version), backend_version = COALESCE($10, backend_version),
                 requested_by = COALESCE($11, requested_by), deployed_by = COALESCE($12, deployed_by),
                 updated_at = NOW()
               WHERE id = $1 RETURNING *`,
              [
                row.id, noteText, nz(started_at), nz(body.deployment_type),
                nz(branch), nz(version), nz(frontend_branch), nz(backend_branch),
                nz(frontend_version), nz(backend_version), nz(requested_by), nz(deployed_by),
                nextStatus, approvedNow, nz(approved_by),
              ]
            );
          } else {
            // Final status for an open (queued / in-progress) row: update the SAME row in place.
            const finalStatus = isRerunRow ? `Rerun - ${status}` : status;
            const doneAt = effectiveCompletedAt || new Date().toISOString();
            let dur: number | null = duration_seconds ?? null;
            if (row.approved_at) {
              // Gated run: lead time starts at approval, so an overnight wait never inflates it. A duration sent by
              // the workflow is measured from its own start (before approval) and is ignored.
              dur = Math.max(0, Math.round((new Date(doneAt).getTime() - new Date(row.approved_at).getTime()) / 1000));
            } else if (openRank(row.status) === 0) {
              // Still 'Awaiting approval' when it ended: rejected / expired / cancelled never ran, so no duration.
              dur = /reject|cancel|fail/i.test(status) ? null : dur || null;
            } else if (dur === null || dur === 0) {
              // started_at stays the original row's value
              dur = Math.max(0, Math.round((new Date(doneAt).getTime() - new Date(row.started_at).getTime()) / 1000));
            }
            result = await client.query(
              `UPDATE deployments SET
                 status = $2, notes = COALESCE($3, notes),
                 completed_at = $4, duration_seconds = $5,
                 branch = COALESCE($6, branch), version = COALESCE($7, version),
                 frontend_branch = COALESCE($8, frontend_branch), backend_branch = COALESCE($9, backend_branch),
                 frontend_version = COALESCE($10, frontend_version), backend_version = COALESCE($11, backend_version),
                 requested_by = COALESCE($12, requested_by), deployed_by = COALESCE($13, deployed_by),
                 approved_by = COALESCE($14, approved_by), tested_by = COALESCE($15, tested_by),
                 updated_at = NOW()
               WHERE id = $1 RETURNING *`,
              [
                row.id, finalStatus, noteText, doneAt, dur,
                nz(branch), nz(version), nz(frontend_branch), nz(backend_branch),
                nz(frontend_version), nz(backend_version), nz(requested_by), nz(deployed_by),
                nz(approved_by), nz(tested_by),
              ]
            );
          }
          updated = true;
          console.log('🔁 In-progress deployment updated in place:', {
            id: row.id, environment: alertEnv ?? targetEnv, status: result.rows[0].status, ticket_link,
          });
        } else {
          // No open row — a previous attempt (if any) is completed: insert a NEW row tagged as rerun.
          // The original row is preserved in history. (For 'Queued' / 'In Progress' this yields 'Rerun - Queued' / 'Rerun - In Progress'.)
          const existing = await client.query(
            'SELECT id, status FROM deployments WHERE ticket_link = $1 ORDER BY created_at DESC LIMIT 1',
            [ticket_link]
          );
          if (existing.rows.length > 0) {
            const rerunStatus = `Rerun - ${status}`;
            const rerunNotes = notes ? `🔄 Rerun: ${notes}` : `🔄 Rerun of failed deployment`;
            result = await client.query(
              `INSERT INTO deployments (
                environment, status, deployment_type, branch, version,
                frontend_branch, backend_branch, frontend_version, backend_version,
                requested_by, approved_by, tested_by, deployed_by,
                ticket_link, notes, started_at, completed_at, duration_seconds
              ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
              RETURNING *`,
              [
                targetEnv, rerunStatus, deployment_type,
                branch || null, version || null,
                frontend_branch || null, backend_branch || null,
                frontend_version || null, backend_version || null,
                requested_by || null, approved_by || null, tested_by || null, deployed_by || null,
                ticket_link, rerunNotes,
                deployStartedAt, effectiveCompletedAt, calculatedDuration || null,
              ]
            );
            console.log('🔄 Re-run detected — new row inserted:', {
              id: result.rows[0].id, environment: targetEnv, status: rerunStatus, ticket_link
            });
          }
        }
      }

      if (!result) {
        // Insert new deployment
        result = await client.query(
          `INSERT INTO deployments (
            environment, 
            status,
            deployment_type,
            branch, 
            version,
            frontend_branch,
            backend_branch,
            frontend_version,
            backend_version,
            requested_by, 
            approved_by,
            tested_by,
            deployed_by,
            ticket_link,
            notes,
            started_at, 
            completed_at, 
            duration_seconds
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
          RETURNING *`,
          [
            targetEnv,
            status,
            deployment_type,
            branch,
            version,
            frontend_branch,
            backend_branch,
            frontend_version,
            backend_version,
            requested_by,
            approved_by,
            tested_by,
            deployed_by,
            ticket_link,
            notes,
            deployStartedAt,
            effectiveCompletedAt,
            calculatedDuration,
          ]
        );
        console.log('✅ Deployment logged:', {
          id: result.rows[0].id,
          environment: targetEnv,
          status,
          requested_by,
        });
      }

      await client.query('COMMIT');
    } catch (txError) {
      await client.query('ROLLBACK').catch(() => {});
      throw txError;
    } finally {
      client.release();
    }

    // Optional Google Chat alert for failures / recoveries (no-op unless GCHAT_ALERT_WEBHOOK_URL is set).
    // Runs after COMMIT, once per final outcome; never for 'Queued' / 'In Progress'.
    await alertIfFinal(result.rows[0]);

    return NextResponse.json({
      success: true,
      deployment: result.rows[0],
      ...(updated ? { updated: true } : {}),
    }, { status: updated ? 200 : 201 });

  } catch (error) {
    console.error('❌ Webhook error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to process webhook',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

// Health check endpoint
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: 'Deployment tracker webhook endpoint',
    usage: 'POST with deployment data and Authorization header',
  });
}
