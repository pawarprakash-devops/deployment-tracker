'use client';
import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

// Admin toolbar for the release page: session, deploy form, targets, import/export, edit/delete events.
// Callers: app/(v2)/page.tsx. Endpoints: /api/auth, /api/auth/session, /api/deployments[/id], /api/environments[/id].

type Row = Record<string, unknown> & { id?: string; environment?: string; version?: string | null; branch?: string | null };
type Env = { id: string; name: string; is_production?: boolean; display_order?: number };
type Form = Record<string, string>;
type Dialog = null | 'login' | 'form' | 'envs' | 'delete' | 'import';

const STATUSES = ['Success', 'Queued', 'In Progress', 'Failed', 'Cancelled', 'Rolled Back'];
const TYPES = ['standard', 'rollback', 'hotfix'];
const TEXT_FIELDS: [string, string][] = [
  ['branch', 'Branch'], ['version', 'Version'], ['frontend_branch', 'Frontend branch'], ['frontend_version', 'Frontend version'],
  ['backend_branch', 'Backend branch'], ['backend_version', 'Backend version'], ['requested_by', 'Requested by'],
  ['approved_by', 'Approved by'], ['tested_by', 'Tested by'], ['deployed_by', 'Deployed by'],
];

const pad = (n: number) => String(n).padStart(2, '0');
// UTC ISO -> value for <input type="datetime-local"> in the viewer's local time zone.
function toLocalInput(iso: unknown): string {
  if (!iso) return '';
  const d = new Date(String(iso));
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
// Local datetime-local value -> UTC ISO. A value without a zone is parsed as local time.
function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
const str = (v: unknown) => (v == null ? '' : String(v));
const emptyForm = (env: string): Form => ({
  environment: env, status: 'Success', deployment_type: 'standard', started_at: toLocalInput(new Date().toISOString()), completed_at: '',
  ticket_link: '', notes: '', ...Object.fromEntries(TEXT_FIELDS.map(([k]) => [k, ''])),
});
const emit = (name: string) => window.dispatchEvent(new Event(name));

async function failText(res: Response, fallback: string): Promise<string> {
  let msg = '';
  try { const j = await res.json(); msg = j?.error || j?.message || ''; } catch { /* body not JSON */ }
  return msg ? `${msg} (HTTP ${res.status})` : `${fallback} (HTTP ${res.status})`;
}

const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--fs-xs)', color: 'var(--muted)', minWidth: 0 };
const inputStyle: React.CSSProperties = {
  border: '1px solid var(--border-bright)', background: 'var(--panel)', color: 'var(--text)', borderRadius: 'var(--r-sm)',
  padding: '6px 10px', fontSize: 'var(--fs-sm)', minHeight: 32, minWidth: 0, width: '100%', fontFamily: 'inherit', boxSizing: 'border-box',
};

function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    opener.current = document.activeElement;
    const el = ref.current;
    const focusables = () => Array.from(el?.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])') ?? []).filter((n) => !n.hasAttribute('disabled'));
    (el?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0] ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const f = focusables();
      if (!f.length) { e.preventDefault(); return; }
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    const prev = opener.current as HTMLElement | null;
    return () => { document.removeEventListener('keydown', onKey, true); prev?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="scrim" style={{ inset: 0, zIndex: 1000, display: 'grid', placeItems: 'center', padding: 12 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} className="card"
        style={{ width: 'min(640px, calc(100vw - 24px))', maxHeight: 'calc(100vh - 24px)', overflowY: 'auto', boxShadow: 'var(--elev-2)' }}>
        <h2 id={id} style={{ fontSize: 'var(--fs-lg)', margin: '0 0 var(--space-3)' }}>{title}</h2>
        {children}
        {footer && <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 'var(--space-4)' }}>{footer}</div>}
      </div>
    </div>
  );
}

const ErrorText = ({ text }: { text: string }) => text ? <p role="alert" style={{ color: 'var(--bad-text)', background: 'var(--bad-bg)', border: '1px solid var(--bad-border)', borderRadius: 'var(--r-sm)', padding: '6px 10px', fontSize: 'var(--fs-sm)', margin: '8px 0 0', overflowWrap: 'anywhere' }}>{text}</p> : null;

export default function ReleaseAdmin() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [envs, setEnvs] = useState<Env[]>([]);
  const [form, setForm] = useState<Form>(emptyForm(''));
  const [editId, setEditId] = useState<string | null>(null);
  const [target, setTarget] = useState<Row | null>(null);
  const [envName, setEnvName] = useState('');
  const [envProd, setEnvProd] = useState(false);
  const [envDelete, setEnvDelete] = useState<Env | null>(null);
  const [importMsg, setImportMsg] = useState('');
  const [note, setNote] = useState('');
  const pwRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadSession = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/session', { cache: 'no-store' });
      const j = r.ok ? await r.json() : null;
      setIsAdmin(j?.role === 'admin');
    } catch { setIsAdmin(false); }
  }, []);
  const loadEnvs = useCallback(async (): Promise<Env[]> => {
    try {
      const r = await fetch('/api/environments', { cache: 'no-store' });
      if (!r.ok) throw new Error(await failText(r, 'Could not load targets'));
      const list = (await r.json()) as Env[];
      setEnvs(list);
      return list;
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load targets'); return []; }
  }, []);

  const close = useCallback(() => { setDialog(null); setError(''); setBusy(false); setEnvDelete(null); setTarget(null); }, []);
  const changed = () => emit('tracker:data-changed');

  useEffect(() => {
    let alive = true;
    fetch('/api/auth/session', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (alive) setIsAdmin(j?.role === 'admin'); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const onEdit = (e: Event) => {
      const row = (e as CustomEvent<Row>).detail;
      if (!row?.id) return;
      setError(''); setEditId(row.id);
      setForm({
        ...emptyForm(str(row.environment)),
        ...Object.fromEntries(['status', 'deployment_type', 'ticket_link', 'notes', ...TEXT_FIELDS.map(([k]) => k)].map((k) => [k, str(row[k])])),
        status: str(row.status) || 'Success', deployment_type: str(row.deployment_type) || 'standard',
        started_at: toLocalInput(row.started_at), completed_at: toLocalInput(row.completed_at),
      });
      loadEnvs(); setDialog('form');
    };
    const onDelete = (e: Event) => {
      const row = (e as CustomEvent<Row>).detail;
      if (!row?.id) return;
      setError(''); setTarget(row); setDialog('delete');
    };
    window.addEventListener('tracker:edit-deployment', onEdit);
    window.addEventListener('tracker:delete-deployment', onDelete);
    return () => { window.removeEventListener('tracker:edit-deployment', onEdit); window.removeEventListener('tracker:delete-deployment', onDelete); };
  }, [loadEnvs]);

  const exportJson = async () => {
    setNote('');
    try {
      const r = await fetch('/api/deployments?limit=1000', { cache: 'no-store' });
      if (!r.ok) throw new Error(await failText(r, 'Export failed'));
      const blob = new Blob([JSON.stringify(await r.json(), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `deployments-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { setNote(e instanceof Error ? e.message : 'Export failed'); }
  };

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    const input = pwRef.current;
    if (!input || !input.value) return;
    const password = input.value;
    input.value = '';
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      if (r.ok) { await loadSession(); emit('tracker:auth-changed'); close(); return; }
      const msg = await failText(r, '').catch(() => '');
      const server = msg.replace(/\s*\(HTTP \d+\)$/, '');
      setError(r.status === 429 ? 'Too many sign-in attempts. Wait a few minutes and try again.'
        : r.status >= 500 ? 'The server could not process the sign-in. Try again shortly.'
        : r.status === 401 ? (server || 'The password was not accepted.') : (server || `Sign-in failed (HTTP ${r.status}).`));
    } catch { setError('Could not reach the server. Check your connection.'); }
    setBusy(false);
  };
  const logout = async () => {
    setNote('');
    try {
      const r = await fetch('/api/auth', { method: 'DELETE' });
      if (!r.ok) throw new Error(await failText(r, 'Sign out failed'));
    } catch (e) { setNote(e instanceof Error ? e.message : 'Sign out failed'); return; }
    await loadSession(); emit('tracker:auth-changed');
  };

  const openCreate = async () => {
    setError(''); setEditId(null);
    const list = await loadEnvs();
    setForm(emptyForm(list[0]?.name ?? ''));
    setDialog('form');
  };
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const saveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.environment || !form.started_at) { setError('Environment and start time are required.'); return; }
    const started = fromLocalInput(form.started_at);
    const completed = fromLocalInput(form.completed_at);
    if (!started) { setError('Start time is not a valid date.'); return; }
    if (completed && new Date(completed) < new Date(started)) { setError('Completed time is before the start time.'); return; }
    const payload: Record<string, unknown> = { ...form, started_at: started, completed_at: completed };
    for (const k of Object.keys(payload)) if (payload[k] === '') payload[k] = null;
    setBusy(true); setError('');
    try {
      const r = await fetch(editId ? `/api/deployments/${editId}` : '/api/deployments', {
        method: editId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(await failText(r, 'Save failed'));
      close(); changed();
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed'); setBusy(false); }
  };

  const confirmDelete = async () => {
    if (!target?.id) return;
    setBusy(true); setError('');
    try {
      const r = await fetch(`/api/deployments/${target.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(await failText(r, 'Delete failed'));
      close(); changed();
    } catch (err) { setError(err instanceof Error ? err.message : 'Delete failed'); setBusy(false); }
  };

  const addEnv = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!envName.trim()) { setError('Target name is required.'); return; }
    setBusy(true); setError('');
    try {
      const order = Math.max(0, ...envs.map((v) => v.display_order ?? 0)) + 1;
      const r = await fetch('/api/environments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: envName.trim(), is_production: envProd, display_order: order }) });
      if (!r.ok) throw new Error(await failText(r, 'Could not add target'));
      setEnvName(''); setEnvProd(false); await loadEnvs(); changed();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not add target'); }
    setBusy(false);
  };
  const removeEnv = async () => {
    if (!envDelete) return;
    setBusy(true); setError('');
    try {
      const r = await fetch(`/api/environments/${envDelete.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(await failText(r, 'Could not delete target'));
      setEnvDelete(null); await loadEnvs(); changed();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not delete target'); }
    setBusy(false);
  };

  const importFile = async (file: File) => {
    setDialog('import'); setBusy(true); setError(''); setImportMsg('Reading file...');
    let rows: unknown;
    try { rows = JSON.parse(await file.text()); } catch { setError('The file is not valid JSON.'); setBusy(false); setImportMsg(''); return; }
    if (!Array.isArray(rows)) { setError('The file must contain a JSON array of deployments.'); setBusy(false); setImportMsg(''); return; }
    let ok = 0, failed = 0, firstErr = '';
    for (let i = 0; i < rows.length; i++) {
      setImportMsg(`Importing ${i + 1} of ${rows.length}...`);
      const item = rows[i];
      if (!item || typeof item !== 'object' || Array.isArray(item)) { failed++; firstErr ||= `Row ${i + 1} is not an object.`; continue; }
      const { id: _id, created_at: _c, updated_at: _u, ...body } = item as Row; // eslint-disable-line @typescript-eslint/no-unused-vars
      try {
        const r = await fetch('/api/deployments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (r.ok) ok++; else { failed++; firstErr ||= `Row ${i + 1}: ${await failText(r, 'Rejected')}`; }
      } catch { failed++; firstErr ||= `Row ${i + 1}: network error.`; }
    }
    setImportMsg(`Finished: ${ok} imported, ${failed} failed out of ${rows.length}.`);
    if (failed) setError(firstErr);
    if (ok) changed();
    setBusy(false);
  };

  const btn = { className: 'btn' } as const;
  const lbl = (text: string, child: React.ReactNode, wide = false) => (
    <label style={{ ...fieldStyle, gridColumn: wide ? '1 / -1' : undefined }}>{text}{child}</label>
  );

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }} className="release-admin">
      <style>{`@media (max-width: 640px) { .release-admin { width: 100%; justify-content: stretch !important; } .release-admin > .btn, .release-admin > a.btn { flex: 1 1 140px; text-align: center; } }`}</style>
      <button type="button" {...btn} onClick={() => emit('tracker:refresh')}>Refresh</button>
      <button type="button" {...btn} onClick={exportJson}>Export JSON</button>
      {!isAdmin && <button type="button" {...btn} onClick={() => { setError(''); setDialog('login'); }}>Admin sign-in</button>}
      {isAdmin && (
        <>
          <button type="button" {...btn} onClick={openCreate}>Deploy release</button>
          <button type="button" {...btn} onClick={async () => { setError(''); await loadEnvs(); setDialog('envs'); }}>Targets</button>
          <button type="button" {...btn} onClick={() => fileRef.current?.click()}>Import JSON</button>
          <Link href="/?tab=insights" className="btn" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>Telemetry</Link>
          <button type="button" {...btn} onClick={logout}>Sign out</button>
        </>
      )}
      <input ref={fileRef} type="file" accept="application/json,.json" hidden aria-label="Import deployments JSON file"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importFile(f); }} />
      {note && <span role="alert" style={{ color: 'var(--bad-text)', fontSize: 'var(--fs-sm)', flexBasis: '100%', textAlign: 'right' }}>{note}</span>}

      {dialog === 'login' && (
        <Modal title="Admin sign-in" onClose={close}>
          <form onSubmit={login} autoComplete="on">
            {lbl('Admin password', <input data-autofocus ref={pwRef} type="password" name="password" autoComplete="current-password" required style={inputStyle} />)}
            <ErrorText text={error} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 'var(--space-4)' }}>
              <button type="button" className="btn" onClick={close}>Cancel</button>
              <button type="submit" className="btn" aria-pressed="true" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</button>
            </div>
          </form>
        </Modal>
      )}

      {dialog === 'form' && (
        <Modal title={editId ? 'Edit deployment' : 'Deploy release'} onClose={close}>
          <form onSubmit={saveForm}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
              {lbl('Environment', <select data-autofocus required value={form.environment} onChange={(e) => set('environment', e.target.value)} style={inputStyle}>
                {form.environment && !envs.some((v) => v.name === form.environment) && <option value={form.environment}>{form.environment}</option>}
                {envs.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}
              </select>)}
              {lbl('Status', <select value={form.status} onChange={(e) => set('status', e.target.value)} style={inputStyle}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>)}
              {lbl('Deployment type', <select value={form.deployment_type} onChange={(e) => set('deployment_type', e.target.value)} style={inputStyle}>{TYPES.map((s) => <option key={s}>{s}</option>)}</select>)}
              {TEXT_FIELDS.map(([k, label]) => lbl(label, <input key={k} type="text" value={form[k]} onChange={(e) => set(k, e.target.value)} style={inputStyle} />))}
              {lbl('Started at (your local time)', <input type="datetime-local" required value={form.started_at} onChange={(e) => set('started_at', e.target.value)} style={inputStyle} />)}
              {lbl('Completed at (your local time)', <input type="datetime-local" value={form.completed_at} onChange={(e) => set('completed_at', e.target.value)} style={inputStyle} />)}
              {lbl('Ticket link', <input type="text" value={form.ticket_link} onChange={(e) => set('ticket_link', e.target.value)} style={inputStyle} />, true)}
              {lbl('Notes', <textarea rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} style={{ ...inputStyle, resize: 'vertical' }} />, true)}
            </div>
            <ErrorText text={error} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 'var(--space-4)' }}>
              <button type="button" className="btn" onClick={close}>Cancel</button>
              <button type="submit" className="btn" aria-pressed="true" disabled={busy}>{busy ? 'Saving...' : editId ? 'Save changes' : 'Create deployment'}</button>
            </div>
          </form>
        </Modal>
      )}

      {dialog === 'delete' && target && (
        <Modal title="Delete deployment" onClose={close} footer={<>
          <button type="button" className="btn" data-autofocus onClick={close}>Cancel</button>
          <button type="button" className="btn" disabled={busy} onClick={confirmDelete} style={{ color: 'var(--bad-text)', borderColor: 'var(--bad-border)' }}>{busy ? 'Deleting...' : 'Delete'}</button>
        </>}>
          <p style={{ margin: 0, fontSize: 'var(--fs-base)' }}>Delete the {str(target.environment)} deployment {str(target.version) || str(target.branch) || '(no version)'}? This cannot be undone.</p>
          <ErrorText text={error} />
        </Modal>
      )}

      {dialog === 'envs' && (
        <Modal title="Deployment targets" onClose={close} footer={<button type="button" className="btn" onClick={close}>Done</button>}>
          {envDelete ? (
            <div>
              <p style={{ margin: 0 }}>Delete target {envDelete.name}? Existing deployments keep their history.</p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                <button type="button" className="btn" data-autofocus onClick={() => setEnvDelete(null)}>Keep</button>
                <button type="button" className="btn" disabled={busy} onClick={removeEnv} style={{ color: 'var(--bad-text)', borderColor: 'var(--bad-border)' }}>Delete target</button>
              </div>
            </div>
          ) : (
            <>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {envs.length === 0 && <li style={{ color: 'var(--muted)', fontSize: 'var(--fs-sm)' }}>No targets yet.</li>}
                {envs.map((v) => (
                  <li key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '6px 10px' }}>
                    <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{v.name}{v.is_production ? ' (production)' : ''}</span>
                    <button type="button" className="btn" onClick={() => { setError(''); setEnvDelete(v); }} aria-label={`Delete target ${v.name}`}>Delete</button>
                  </li>
                ))}
              </ul>
              <form onSubmit={addEnv} style={{ marginTop: 'var(--space-4)', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
                <label style={{ ...fieldStyle, flex: '1 1 200px' }}>New target name<input data-autofocus type="text" value={envName} onChange={(e) => setEnvName(e.target.value)} style={inputStyle} /></label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)', minHeight: 32 }}><input type="checkbox" checked={envProd} onChange={(e) => setEnvProd(e.target.checked)} />Production</label>
                <button type="submit" className="btn" disabled={busy}>Add target</button>
              </form>
            </>
          )}
          <ErrorText text={error} />
        </Modal>
      )}

      {dialog === 'import' && (
        <Modal title="Import deployments" onClose={busy ? () => undefined : close} footer={<button type="button" className="btn" data-autofocus disabled={busy} onClick={close}>Close</button>}>
          <p role="status" style={{ margin: 0 }}>{importMsg}</p>
          <ErrorText text={error} />
        </Modal>
      )}
    </div>
  );
}
