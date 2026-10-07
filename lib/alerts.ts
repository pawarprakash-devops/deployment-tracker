import pool from '@/lib/db';

// Google Chat alerts for failed deployments and recoveries (MTTR). Entirely optional and best-effort:
// set GCHAT_ALERT_WEBHOOK_URL (Space -> Apps & integrations -> Webhooks) in Vercel to enable it;
// MTTR_TARGET_MINUTES (default 30) is the target a recovery is compared against.
// Errors are swallowed so an alert problem can never fail the deployment webhook.

const isFailed = (s: string) => /(^|\s)failed$/i.test(s);
const isSuccess = (s: string) => /(^|\s)success$/i.test(s);
const fmt = (min: number) => (min < 90 ? `${Math.round(min)} min` : `${(min / 60).toFixed(1)} h`);

async function post(text: string) {
  const url = process.env.GCHAT_ALERT_WEBHOOK_URL;
  if (!url) return;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 4000);
  try {
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify({ text }), signal: ctl.signal });
  } catch (e) {
    console.error('Alert delivery failed:', e instanceof Error ? e.message : e);
  } finally {
    clearTimeout(t);
  }
}

export async function notifyDeployment(row: {
  id: string; environment: string; status: string; branch?: string | null; version?: string | null;
  deployed_by?: string | null; requested_by?: string | null; ticket_link?: string | null; started_at: string | Date; completed_at?: string | Date | null;
}, isProduction: boolean) {
  try {
    if (!process.env.GCHAT_ALERT_WEBHOOK_URL) return;
    const link = row.ticket_link ? `\n<${row.ticket_link}|Open workflow run>` : '';
    const who = row.requested_by || row.deployed_by || 'unknown';

    if (isFailed(row.status)) {
      await post(`${isProduction ? '🚨 *PRODUCTION* deployment FAILED' : '❌ Deployment failed'} — *${row.environment}*\nBranch: \`${row.branch || '-'}\` · Version: \`${row.version || '-'}\` · By: ${who}${link}`);
      return;
    }

    if (isSuccess(row.status)) {
      // Recovery: this success follows one or more failures on the same environment
      const at = new Date(row.started_at);
      const lastOk = await pool.query(
        `SELECT started_at FROM deployments WHERE environment = $1 AND id <> $2 AND started_at < $3 AND status ~* '(^|\\s)success$' ORDER BY started_at DESC LIMIT 1`,
        [row.environment, row.id, at]);
      const since = lastOk.rows[0]?.started_at ?? new Date(0);
      const firstFail = await pool.query(
        `SELECT MIN(started_at) AS t FROM deployments WHERE environment = $1 AND id <> $2 AND started_at > $3 AND started_at < $4 AND status ~* '(^|\\s)failed$'`,
        [row.environment, row.id, since, at]);
      const t0 = firstFail.rows[0]?.t;
      if (!t0) return;
      const end = new Date(row.completed_at || row.started_at).getTime();
      const mttrMin = (end - new Date(t0).getTime()) / 60000;
      const target = parseInt(process.env.MTTR_TARGET_MINUTES || '30', 10);
      const verdict = mttrMin <= target ? `✅ within ${target} min target` : `⚠️ exceeded the ${target} min target`;
      await post(`🟢 *${row.environment}* recovered — time to restore *${fmt(mttrMin)}* (${verdict})\nFix deployed by ${who}${link}`);
    }
  } catch (e) {
    console.error('notifyDeployment error:', e instanceof Error ? e.message : e);
  }
}
