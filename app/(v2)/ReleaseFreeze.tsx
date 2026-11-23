'use client';
import { useCallback, useEffect, useReducer, useState } from 'react';
import { Snowflake, Trash2 } from 'lucide-react';
import { Modal } from './ReleaseAdmin';

export interface Freeze { id: string; environment: string; starts_at: string; ends_at: string; reason: string; created_by: string | null; active: boolean }

// ---- shared freeze store (one fetch for the banner and the history badges) ----
let cache: Freeze[] | null = null;
let cacheNow = 0; // server clock at the last load, so render never calls Date.now()
let inflight: Promise<void> | null = null;
const subs = new Set<() => void>();
export const freezeNow = () => cacheNow;
function load() {
  inflight ??= fetch('/api/freeze', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : { windows: [] }))
    .then((d) => { cache = d.windows ?? []; cacheNow = Date.parse(d.now) || Date.now(); })
    .catch(() => { cache ??= []; })
    .finally(() => { inflight = null; subs.forEach((f) => f()); });
}
export const freezeChanged = () => window.dispatchEvent(new Event('tracker:freeze-changed'));

export function useFreezes(): Freeze[] | null {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    subs.add(force);
    if (!cache) load();
    const on = () => load();
    window.addEventListener('tracker:freeze-changed', on);
    return () => { subs.delete(force); window.removeEventListener('tracker:freeze-changed', on); };
  }, []);
  return cache;
}

// The freeze window (if any) a deploy to `env` at `iso` falls in.
export function freezeFor(freezes: Freeze[] | null, env: string, iso: string): Freeze | null {
  if (!freezes?.length || !iso) return null;
  const t = Date.parse(iso);
  return freezes.find((f) => (f.environment === '*' || f.environment === env) && t >= Date.parse(f.starts_at) && t < Date.parse(f.ends_at)) ?? null;
}

// ---- formatting (IST) ----
const IST = 'Asia/Kolkata';
const fmt = (iso: string) => new Intl.DateTimeFormat('en-IN', { timeZone: IST, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
const envLabel = (e: string) => (e === '*' ? 'all environments' : e);
const istInputToISO = (v: string) => (v ? new Date(`${v}:00+05:30`).toISOString() : '');

function useIsAdmin() {
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    const check = () => fetch('/api/auth/session', { cache: 'no-store' }).then((r) => r.json()).then((j) => setAdmin(j?.role === 'admin')).catch(() => setAdmin(false));
    check();
    window.addEventListener('tracker:auth-changed', check);
    return () => window.removeEventListener('tracker:auth-changed', check);
  }, []);
  return admin;
}

function FreezeManager({ freezes, onClose }: { freezes: Freeze[]; onClose: () => void }) {
  const [envs, setEnvs] = useState<string[]>([]);
  const [f, setF] = useState({ environment: '*', start: '', end: '', reason: '', created_by: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch('/api/environments', { cache: 'no-store' }).then((r) => r.json())
      .then((d) => setEnvs((Array.isArray(d) ? d : d.environments ?? []).map((e: { name: string }) => e.name)))
      .catch(() => setEnvs([]));
  }, []);
  const upcoming = freezes.filter((x) => Date.parse(x.ends_at) > freezeNow());

  const save = useCallback(async () => {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/freeze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment: f.environment, starts_at: istInputToISO(f.start), ends_at: istInputToISO(f.end), reason: f.reason, created_by: f.created_by }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`);
      setF((x) => ({ ...x, start: '', end: '', reason: '' }));
      freezeChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
  }, [f]);

  const cancel = async (id: string) => {
    if (!window.confirm('Cancel this freeze window?')) return;
    const r = await fetch(`/api/freeze/${id}`, { method: 'DELETE' });
    if (r.ok) freezeChanged(); else setErr((await r.json().catch(() => ({}))).error || 'Failed to cancel');
  };

  return (
    <Modal title="❄️ Deploy freeze windows" onClose={onClose}>
      <p className="freeze-help">During a freeze nobody should deploy to that environment. The board shows a banner, and deploys that land inside a freeze are flagged ❄️ in the history. Times are IST.</p>
      {upcoming.length > 0 && (
        <ul className="freeze-list">
          {upcoming.map((x) => (
            <li key={x.id} className={x.active ? 'is-active' : ''}>
              <Snowflake size={14} />
              <div>
                <strong>{envLabel(x.environment)}</strong> · {fmt(x.starts_at)} → {fmt(x.ends_at)}
                <div className="subtle">{x.reason}{x.created_by ? ` · by ${x.created_by}` : ''}{x.active ? ' · active now' : ''}</div>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => cancel(x.id)} aria-label="Cancel freeze"><Trash2 size={13} /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="freeze-form">
        <label>Environment
          <select value={f.environment} onChange={(e) => setF({ ...f, environment: e.target.value })}>
            <option value="*">All environments</option>
            {envs.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </label>
        <label>Starts (IST)<input type="datetime-local" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></label>
        <label>Ends (IST)<input type="datetime-local" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></label>
        <label className="wide">Reason<input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Clinic hours, release weekend, audit…" /></label>
        <label className="wide">Your name<input value={f.created_by} onChange={(e) => setF({ ...f, created_by: e.target.value })} /></label>
      </div>
      {err && <div className="freeze-error" role="alert">{err}</div>}
      <div className="freeze-actions">
        <button type="button" className="btn btn-sm" disabled={busy || !f.start || !f.end || !f.reason || !f.created_by} onClick={save}>❄️ Schedule freeze</button>
      </div>
    </Modal>
  );
}

// Banner for active / upcoming (7 days) freezes, plus the admin manager.
export default function ReleaseFreeze() {
  const freezes = useFreezes();
  const admin = useIsAdmin();
  const [open, setOpen] = useState(false);
  if (!freezes) return null;
  const now = freezeNow();
  const active = freezes.filter((x) => Date.parse(x.starts_at) <= now && Date.parse(x.ends_at) > now);
  const soon = freezes.filter((x) => Date.parse(x.starts_at) > now && Date.parse(x.starts_at) - now < 7 * 86_400_000);
  if (!active.length && !soon.length && !admin) return null;

  return (
    <div className="freeze-zone">
      {active.map((x) => (
        <div key={x.id} className="freeze-banner is-active" role="status">
          <Snowflake size={16} className="freeze-flake" />
          <span><strong>Deploy freeze on {envLabel(x.environment)}</strong> until {fmt(x.ends_at)} IST · {x.reason}</span>
        </div>
      ))}
      {soon.map((x) => (
        <div key={x.id} className="freeze-banner" role="status">
          <Snowflake size={16} />
          <span>Upcoming freeze on <strong>{envLabel(x.environment)}</strong>: {fmt(x.starts_at)} → {fmt(x.ends_at)} IST · {x.reason}</span>
        </div>
      ))}
      {admin && (
        <button type="button" className="freeze-manage" onClick={() => setOpen(true)}>
          <Snowflake size={13} /> {active.length || soon.length ? 'Manage freezes' : 'Schedule a deploy freeze'}
        </button>
      )}
      {open && <FreezeManager freezes={freezes} onClose={() => setOpen(false)} />}
    </div>
  );
}
