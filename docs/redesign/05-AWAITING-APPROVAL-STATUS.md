# Awaiting approval and Rejected statuses (2026-10-09)

Why: deploys to Stage, Pre-Prod and Prod will pause on a GitHub Environment approval (sole approver: DevOps). A run waiting overnight must not show as running, must not inflate lead time, and a declined or expired approval needs a final status. Plan: `DEPLOYMENT-APPROVAL-AND-AUTO-DISPATCH-PLAN-2026-10-09.md` section 9.1 (outside this repo).

## Webhook

| Status | Kind | Meaning |
|---|---|---|
| `Awaiting approval` | open, rank 0 | Paused on an approval. No `completed_at`, no duration, no alert |
| `Queued` | open, rank 1 | Approved, waiting behind an earlier run in the FIFO lane |
| `In Progress` | open, rank 2 | Running |
| `Rejected` | final | Approval declined (or expired/superseded). Never ran |

All posts for one run use the same `ticket_link` (run URL) and normalised environment and update **one row**. A post only moves the row up the ladder; a lower or equal post never downgrades it.

| Current row | Post | Result |
|---|---|---|
| (none) | Awaiting approval | insert (201) |
| Awaiting approval | Awaiting approval | no change, notes refreshed (200) |
| Awaiting approval | Queued / In Progress | upgraded in place, `approved_at` stamped |
| Queued | In Progress | upgraded in place |
| Queued / In Progress | Awaiting approval | ignored (status kept, notes refreshed) |
| In Progress | Queued | ignored |
| any open | Success / Failed / Cancelled / Rolled Back / Rejected | final, same row |
| completed | Awaiting approval (same run URL, "re-run all jobs") | insert `Rerun - Awaiting approval` |

Payloads use the existing fields: `environment`, `status`, `ticket_link`, `started_at`, `notes`, branches/versions, people. Optional `approved_by` is stored when the row leaves `Awaiting approval`.

## Duration

`approved_at` (nullable `TIMESTAMPTZ`) is stamped when a row leaves `Awaiting approval`. At the final post, `duration_seconds = completed_at - approved_at` and any duration sent by the workflow is ignored for such rows. A row that ends while still awaiting (Rejected / Cancelled / Failed) gets a null duration. Rows that never awaited keep the old rule (from `started_at`). `started_at` stays the first post's time, so the history still shows when the run was requested.

The column is added with `ADD COLUMN IF NOT EXISTS` by the webhook (once per server instance) and by `/api/migrate`. Nothing needs running before the deploy.

## Counts and success rate

`/api/summary` returns `awaiting_approval` and `rejected` next to `queued`. The Delivery pulse success rate and the Insights success/failure/change-failure rates exclude `Awaiting approval` and `Rejected` from the denominator (nothing started, or nothing ran). `Cancelled` and `Failed` stay in. Environment cards, Pipeline and the Release lens never count an awaiting run as running.

## UI

| Status | Pill | Where it reads "Awaiting approval - waiting for DevOps approval" |
|---|---|---|
| Awaiting approval | info tone, pause glyph, label | environment card, Pipeline column header, Release lens table and banner |
| Rejected | warn tone, slashed-circle glyph, label | history, drawer |

History status filter, sort, compare and the detail drawer include both statuses; the drawer and compare show `Approved at`, and the drawer marks the duration "(from approval)". Status is never shown by colour alone (glyph plus label).

## Merge order

Merge this PR and wait for the Vercel deploy before the `vidai-devops` PR that posts `Awaiting approval`. The previous webhook stores unknown statuses as a final row (with `completed_at` and a duration), so an early post would create a wrong "completed" row.
