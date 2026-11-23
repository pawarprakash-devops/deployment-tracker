'use client';
import { useEffect, useMemo, useState } from 'react';
import { useShell } from './ctx';
import { Card, StatusPill, fmtDateTime } from './ui';

interface Row { id: string; environment: string; status: string; started_at: string; frontend_branch?: string | null; backend_branch?: string | null }

const WEEKS = 26;
const IST_MS = 5.5 * 3600_000;
const dayKey = (iso: string) => new Date(new Date(iso).getTime() + IST_MS).toISOString().slice(0, 10);
const FAILED = /fail|rolled back/i;
const DAYS = ['Mon', '', 'Wed', '', 'Fri', '', ''];

// GitHub-style calendar of deploys per day (IST) for the last 26 weeks. Red tint = a failure that day.
export default function DeployHeatmap() {
  const { refreshKey } = useShell();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loadedAt, setLoadedAt] = useState(0); // "today" is taken when the data arrives, not during render
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    // The API returns at most 1000 rows per call (newest first), so page with offset until the
    // oldest row is older than the window (VidAI deploys often enough that 1000 rows is ~5 weeks).
    (async () => {
      const cutoff = Date.now() - WEEKS * 7 * 86_400_000;
      const all: Row[] = [];
      try {
        for (let page = 0; page < 10; page++) {
          const r = await fetch(`/api/deployments?limit=1000&offset=${page * 1000}`, { cache: 'no-store' });
          const d = await r.json();
          const batch: Row[] = Array.isArray(d) ? d : d.deployments ?? [];
          all.push(...batch);
          if (batch.length < 1000 || Date.parse(batch[batch.length - 1].started_at) < cutoff) break;
        }
      } catch { /* show whatever loaded */ }
      if (live) { setRows(all); setLoadedAt(Date.now()); }
    })();
    return () => { live = false; };
  }, [refreshKey]);

  const { weeks, byDay, max, total, failed } = useMemo(() => {
    const byDay = new Map<string, Row[]>();
    for (const r of rows ?? []) {
      const k = dayKey(r.started_at);
      (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(r);
    }
    // Grid: columns are weeks (Mon-Sun), last column contains today (IST).
    const todayIst = new Date(loadedAt + IST_MS);
    const dow = (todayIst.getUTCDay() + 6) % 7; // 0 = Monday
    const start = new Date(Date.UTC(todayIst.getUTCFullYear(), todayIst.getUTCMonth(), todayIst.getUTCDate() - dow - (WEEKS - 1) * 7));
    const today = todayIst.toISOString().slice(0, 10);
    const weeks: { key: string; future: boolean }[][] = [];
    let max = 0, total = 0, failed = 0;
    for (let w = 0; w < WEEKS; w++) {
      const col = [];
      for (let d = 0; d < 7; d++) {
        const key = new Date(start.getTime() + (w * 7 + d) * 86_400_000).toISOString().slice(0, 10);
        const list = key > today ? [] : byDay.get(key) ?? [];
        max = Math.max(max, list.length);
        total += list.length; // only days inside the grid count
        failed += list.filter((r) => FAILED.test(r.status)).length;
        col.push({ key, future: key > today });
      }
      weeks.push(col);
    }
    return { weeks, byDay, max, total, failed };
  }, [rows, loadedAt]);

  const level = (n: number) => (n === 0 ? 0 : Math.min(4, Math.ceil((n / Math.max(max, 1)) * 4)));
  const dayRows = picked ? (byDay.get(picked) ?? []).slice().sort((a, b) => b.started_at.localeCompare(a.started_at)) : [];

  return (
    <Card title="Deploy calendar" subtitle={`Deploys per day (IST), last ${WEEKS} weeks · ${total} deploys, ${failed} failed`}>
      {!rows ? <div className="subtle">Loading…</div> : (
        <>
          <div className="heatmap" role="grid" aria-label="Deploys per day">
            <div className="heatmap-days" aria-hidden="true">{DAYS.map((d, i) => <span key={i}>{d}</span>)}</div>
            <div className="heatmap-grid">
              {weeks.map((col, w) => (
                <div key={w} className="heatmap-col" style={{ animationDelay: `${w * 18}ms` }}>
                  {col.map((c) => {
                    const list = byDay.get(c.key) ?? [];
                    const bad = list.some((r) => FAILED.test(r.status));
                    return (
                      <button key={c.key} type="button" disabled={c.future}
                        className={`heatmap-cell l${level(list.length)} ${bad ? 'has-fail' : ''} ${picked === c.key ? 'is-picked' : ''}`}
                        title={`${c.key}: ${list.length} deploy${list.length === 1 ? '' : 's'}${bad ? `, ${list.filter((r) => FAILED.test(r.status)).length} failed` : ''}`}
                        onClick={() => setPicked(picked === c.key ? null : c.key)} />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="heatmap-legend">
            <span>Less</span>{[0, 1, 2, 3, 4].map((l) => <i key={l} className={`heatmap-cell l${l}`} />)}<span>More</span>
            <i className="heatmap-cell l2 has-fail" /><span>had a failure</span>
          </div>
          {picked && (
            <div className="heatmap-day">
              <div className="heatmap-day-title">{picked}: {dayRows.length} deploy{dayRows.length === 1 ? '' : 's'}</div>
              {dayRows.length === 0 ? <div className="subtle">No deploys that day.</div> : (
                <ul>
                  {dayRows.map((r) => (
                    <li key={r.id}>
                      <StatusPill status={r.status} />
                      <strong>{r.environment}</strong>
                      <span className="subtle">{[r.frontend_branch && `FE ${r.frontend_branch}`, r.backend_branch && `BE ${r.backend_branch}`].filter(Boolean).join(' · ')}</span>
                      <span className="subtle tnum">{fmtDateTime(r.started_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
