'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  Download,
  Upload,
  PlusCircle,
  Settings,
  LogIn,
  LogOut,
  Trash2,
  X,
  Shield,
  Loader2,
  Server,
} from 'lucide-react';

type Row = Record<string, unknown> & { id?: string; environment?: string; version?: string | null; branch?: string | null };
type Env = { id: string; name: string; is_production?: boolean; display_order?: number };
type Form = Record<string, string>;
type Dialog = null | 'login' | 'form' | 'envs' | 'delete' | 'import';

const STATUSES = ['Success', 'Awaiting approval', 'Queued', 'In Progress', 'Failed', 'Cancelled', 'Rejected', 'Rolled Back'];
const TYPES = ['standard', 'rollback', 'hotfix'];
const TEXT_FIELDS: [string, string][] = [
  ['branch', 'Branch'], ['version', 'Version'], ['frontend_branch', 'Frontend branch'], ['frontend_version', 'Frontend version'],
  ['backend_branch', 'Backend branch'], ['backend_version', 'Backend version'], ['requested_by', 'Requested by'],
  ['approved_by', 'Approved by'], ['tested_by', 'Tested by'], ['deployed_by', 'Deployed by'],
];

const pad = (n: number) => String(n).padStart(2, '0');
function toLocalInput(iso: unknown): string {
  if (!iso) return '';
  const d = new Date(String(iso));
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
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

const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: '12px', color: 'var(--muted)', minWidth: 0 };
const inputStyle: React.CSSProperties = {
  border: '1px solid var(--border-bright)', background: 'var(--panel)', color: 'var(--text)', borderRadius: 'var(--r-sm)',
  padding: '6px 10px', fontSize: '13px', minHeight: 32, minWidth: 0, width: '100%', fontFamily: 'inherit', boxSizing: 'border-box',
};

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
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
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [onClose]);

  return (
    <div className="palette-backdrop" onClick={onClose} role="presentation">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} className="palette-modal" style={{ maxWidth: 640, padding: 20 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 id={id} style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close dialog" style={{ border: 0, background: 'none', color: 'var(--muted)', cursor: 'pointer' }}>
            <X size={16} />
          </button>
        </div>
        {children}
        {footer && <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>{footer}</div>}
      </div>
    </div>
  );
}

const ErrorText = ({ text }: { text: string }) => (!text ? null : (
  <div style={{ color: 'var(--bad-text)', background: 'var(--bad-bg)', border: '1px solid var(--bad-border)', borderRadius: 'var(--r-sm)', padding: '6px 10px', fontSize: 12, marginTop: 8 }} role="alert">
    {text}
  </div>
));

export default function ReleaseAdmin() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [envs, setEnvs] = useState<Env[]>([]);
  const [form, setForm] = useState<Form>(() => emptyForm(''));
  const [editId, setEditId] = useState<string | null>(null);
  const [target, setTarget] = useState<Row | null>(null);
  const [envName, setEnvName] = useState('');
  const [envProd, setEnvProd] = useState(false);
  const [envDelete, setEnvDelete] = useState<Env | null>(null);
  const [importMsg, setImportMsg] = useState('');
  const [note, setNote] = useState('');

  const pwRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const check = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/session', { cache: 'no-store' });
      const j = await r.json();
      setIsAdmin(j?.role === 'admin');
    } catch { setIsAdmin(false); }
  }, []);

  useEffect(() => {
    void check();
    const onAuth = () => void check();
    window.addEventListener('tracker:auth-changed', onAuth);
    return () => window.removeEventListener('tracker:auth-changed', onAuth);
  }, [check]);

  const loadEnvs = async () => {
    try {
      const r = await fetch('/api/environments', { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        setEnvs(Array.isArray(j) ? j : []);
      }
    } catch { /* ignore */ }
  };

  const close = () => { if (!busy) { setDialog(null); setError(''); } };
  const changed = () => { emit('tracker:data-changed'); emit('tracker:refresh'); };

  // Listen for edit and delete events dispatched from rows
  useEffect(() => {
    const onEdit = async (e: Event) => {
      const row = (e as CustomEvent<Row>).detail;
      if (!row?.id) return;
      await loadEnvs();
      setEditId(String(row.id));
      const next: Form = { ...emptyForm(str(row.environment)) };
      for (const k of Object.keys(next)) {
        if (k === 'started_at' || k === 'completed_at') next[k] = toLocalInput(row[k]);
        else if (row[k] != null) next[k] = String(row[k]);
      }
      setForm(next);
      setError('');
      setDialog('form');
    };
    const onDelete = (e: Event) => {
      const row = (e as CustomEvent<Row>).detail;
      if (!row?.id) return;
      setTarget(row);
      setError('');
      setDialog('delete');
    };
    window.addEventListener('tracker:edit-deployment', onEdit);
    window.addEventListener('tracker:delete-deployment', onDelete);
    return () => {
      window.removeEventListener('tracker:edit-deployment', onEdit);
      window.removeEventListener('tracker:delete-deployment', onDelete);
    };
  }, []);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    const pw = pwRef.current?.value || '';
    if (!pw || busy) return;
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
      if (!r.ok) {
        setError(r.status === 429 ? 'Too many attempts. Wait a minute.' : 'Wrong operator password.');
      } else {
        setIsAdmin(true);
        emit('tracker:auth-changed');
        close();
      }
    } catch { setError('Network error.'); } finally { setBusy(false); }
  };

  const logout = async () => {
    try { await fetch('/api/auth', { method: 'DELETE' }); } catch { /* ignore */ }
    setIsAdmin(false);
    emit('tracker:auth-changed');
  };

  const openCreate = async () => {
    await loadEnvs();
    setEditId(null);
    setForm(emptyForm(envs[0]?.name || 'Preview'));
    setError('');
    setDialog('form');
  };

  const set = (k: string, v: string) => setForm((prev) => ({ ...prev, [k]: v }));

  const saveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    const payload: Record<string, unknown> = { ...form };
    payload.started_at = fromLocalInput(form.started_at);
    payload.completed_at = fromLocalInput(form.completed_at);
    if (!payload.started_at) { setError('A valid start time is required.'); setBusy(false); return; }
    try {
      const url = editId ? `/api/deployments/${editId}` : '/api/deployments';
      const method = editId ? 'PATCH' : 'POST';
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!r.ok) { setError(await failText(r, 'Save failed')); }
      else { changed(); close(); }
    } catch { setError('Network error.'); } finally { setBusy(false); }
  };

  const confirmDelete = async () => {
    if (!target?.id || busy) return;
    setBusy(true); setError('');
    try {
      const r = await fetch(`/api/deployments/${target.id}`, { method: 'DELETE' });
      if (!r.ok) { setError(await failText(r, 'Delete failed')); }
      else { changed(); close(); }
    } catch { setError('Network error.'); } finally { setBusy(false); }
  };

  const addEnv = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = envName.trim();
    if (!name || busy) return;
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/environments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, is_production: envProd }) });
      if (!r.ok) { setError(await failText(r, 'Could not add target')); }
      else { setEnvName(''); setEnvProd(false); await loadEnvs(); changed(); }
    } catch { setError('Network error.'); } finally { setBusy(false); }
  };

  const removeEnv = async () => {
    if (!envDelete || busy) return;
    setBusy(true); setError('');
    try {
      const r = await fetch(`/api/environments/${envDelete.id}`, { method: 'DELETE' });
      if (!r.ok) { setError(await failText(r, 'Could not delete target')); }
      else { setEnvDelete(null); await loadEnvs(); changed(); }
    } catch { setError('Network error.'); } finally { setBusy(false); }
  };

  const exportJson = () => {
    window.open('/api/deployments?limit=1000', '_blank');
  };

  const importFile = async (file: File) => {
    setBusy(true); setError(''); setImportMsg('Parsing JSON...'); setDialog('import');
    let text = '';
    try { text = await file.text(); } catch { setError('Could not read file.'); setBusy(false); return; }
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { setError('File is not valid JSON.'); setBusy(false); return; }
    const rows = Array.isArray(parsed) ? parsed : (parsed as { deployments?: unknown[] })?.deployments;
    if (!Array.isArray(rows) || !rows.length) { setError('JSON must be an array of deployment objects.'); setBusy(false); return; }
    let ok = 0, failed = 0, firstErr = '';
    for (let i = 0; i < rows.length; i++) {
      try {
        const body = rows[i];
        const r = await fetch('/api/deployments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (r.ok) ok++; else { failed++; firstErr ||= `Row ${i + 1}: ${await failText(r, 'Rejected')}`; }
      } catch { failed++; firstErr ||= `Row ${i + 1}: network error.`; }
    }
    setImportMsg(`Finished: ${ok} imported, ${failed} failed out of ${rows.length}.`);
    if (failed) setError(firstErr);
    if (ok) changed();
    setBusy(false);
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
      <button type="button" className="btn btn-secondary btn-sm" onClick={exportJson} title="Export JSON records">
        <Download size={13} />
        <span>Export JSON</span>
      </button>

      {!isAdmin ? (
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setError(''); setDialog('login'); }}>
          <LogIn size={13} />
          <span>Admin Login</span>
        </button>
      ) : (
        <>
          <button type="button" className="btn btn-accent btn-sm" onClick={openCreate}>
            <PlusCircle size={13} />
            <span>Deploy Release</span>
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={async () => { setError(''); await loadEnvs(); setDialog('envs'); }}>
            <Server size={13} />
            <span>Targets</span>
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>
            <Upload size={13} />
            <span>Import JSON</span>
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={logout} title="Sign out of operator session">
            <LogOut size={13} />
            <span>Sign out</span>
          </button>
        </>
      )}

      <input ref={fileRef} type="file" accept="application/json,.json" hidden aria-label="Import deployments JSON"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importFile(f); }} />

      {dialog === 'login' && (
        <Modal title="Operator Sign-in" onClose={close}>
          <form onSubmit={login} autoComplete="on">
            <label style={fieldStyle}>
              <span>Admin Token / Password</span>
              <input data-autofocus ref={pwRef} type="password" name="password" autoComplete="current-password" required style={inputStyle} />
            </label>
            <ErrorText text={error} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" className="btn btn-secondary" onClick={close}>Cancel</button>
              <button type="submit" className="btn btn-accent" disabled={busy}>{busy ? 'Verifying...' : 'Sign In'}</button>
            </div>
          </form>
        </Modal>
      )}

      {dialog === 'form' && (
        <Modal title={editId ? 'Edit Deployment' : 'Deploy Release'} onClose={close}>
          <form onSubmit={saveForm}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
              <label style={fieldStyle}>
                <span>Environment</span>
                <select data-autofocus required value={form.environment} onChange={(e) => set('environment', e.target.value)} style={inputStyle}>
                  {form.environment && !envs.some((v) => v.name === form.environment) && <option value={form.environment}>{form.environment}</option>}
                  {envs.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}
                </select>
              </label>
              <label style={fieldStyle}>
                <span>Status</span>
                <select value={form.status} onChange={(e) => set('status', e.target.value)} style={inputStyle}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
              </label>
              <label style={fieldStyle}>
                <span>Deployment Type</span>
                <select value={form.deployment_type} onChange={(e) => set('deployment_type', e.target.value)} style={inputStyle}>{TYPES.map((s) => <option key={s}>{s}</option>)}</select>
              </label>
              {TEXT_FIELDS.map(([k, label]) => (
                <label key={k} style={fieldStyle}>
                  <span>{label}</span>
                  <input type="text" value={form[k]} onChange={(e) => set(k, e.target.value)} style={inputStyle} />
                </label>
              ))}
              <label style={fieldStyle}>
                <span>Started at (local time)</span>
                <input type="datetime-local" required value={form.started_at} onChange={(e) => set('started_at', e.target.value)} style={inputStyle} />
              </label>
              <label style={fieldStyle}>
                <span>Completed at (local time)</span>
                <input type="datetime-local" value={form.completed_at} onChange={(e) => set('completed_at', e.target.value)} style={inputStyle} />
              </label>
              <label style={{ ...fieldStyle, gridColumn: '1 / -1' }}>
                <span>Workflow / Ticket Link</span>
                <input type="text" value={form.ticket_link} onChange={(e) => set('ticket_link', e.target.value)} style={inputStyle} />
              </label>
              <label style={{ ...fieldStyle, gridColumn: '1 / -1' }}>
                <span>Execution Notes</span>
                <textarea rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} style={{ ...inputStyle, resize: 'vertical' }} />
              </label>
            </div>
            <ErrorText text={error} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" className="btn btn-secondary" onClick={close}>Cancel</button>
              <button type="submit" className="btn btn-accent" disabled={busy}>{busy ? 'Saving...' : editId ? 'Save Changes' : 'Record Release'}</button>
            </div>
          </form>
        </Modal>
      )}

      {dialog === 'delete' && target && (
        <Modal title="Delete Deployment" onClose={close} footer={
          <>
            <button type="button" className="btn btn-secondary" data-autofocus onClick={close}>Cancel</button>
            <button type="button" className="btn" disabled={busy} onClick={confirmDelete} style={{ background: 'var(--bad-bg)', color: 'var(--bad-text)', border: '1px solid var(--bad-border)' }}>
              {busy ? 'Deleting...' : 'Delete'}
            </button>
          </>
        }>
          <p style={{ margin: 0, color: 'var(--text)' }}>
            Delete the <strong>{str(target.environment)}</strong> deployment {str(target.version) || str(target.branch) || '(no version)'}? This action cannot be undone.
          </p>
          <ErrorText text={error} />
        </Modal>
      )}

      {dialog === 'envs' && (
        <Modal title="Deployment Targets" onClose={close} footer={<button type="button" className="btn btn-secondary" onClick={close}>Done</button>}>
          {envDelete ? (
            <div>
              <p style={{ margin: 0 }}>Delete target <strong>{envDelete.name}</strong>? Existing deployments keep their history.</p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                <button type="button" className="btn btn-secondary" data-autofocus onClick={() => setEnvDelete(null)}>Keep</button>
                <button type="button" className="btn" disabled={busy} onClick={removeEnv} style={{ background: 'var(--bad-bg)', color: 'var(--bad-text)', border: '1px solid var(--bad-border)' }}>Delete Target</button>
              </div>
            </div>
          ) : (
            <>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {envs.length === 0 && <li style={{ color: 'var(--muted)', fontSize: 13 }}>No targets registered.</li>}
                {envs.map((v) => (
                  <li key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '6px 10px', background: 'var(--panel-2)' }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>{v.name}{v.is_production ? ' (prod)' : ''}</span>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => { setError(''); setEnvDelete(v); }}>Delete</button>
                  </li>
                ))}
              </ul>
              <form onSubmit={addEnv} style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
                <label style={{ ...fieldStyle, flex: '1 1 200px' }}>
                  <span>New Target Name</span>
                  <input data-autofocus type="text" value={envName} onChange={(e) => setEnvName(e.target.value)} style={inputStyle} />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, minHeight: 32 }}>
                  <input type="checkbox" checked={envProd} onChange={(e) => setEnvProd(e.target.checked)} />
                  <span>Production</span>
                </label>
                <button type="submit" className="btn btn-accent btn-sm" disabled={busy}>Add Target</button>
              </form>
            </>
          )}
          <ErrorText text={error} />
        </Modal>
      )}

      {dialog === 'import' && (
        <Modal title="Import Deployments" onClose={busy ? () => undefined : close} footer={<button type="button" className="btn btn-secondary" data-autofocus disabled={busy} onClick={close}>Close</button>}>
          <p role="status" style={{ margin: 0, color: 'var(--text)' }}>{importMsg}</p>
          <ErrorText text={error} />
        </Modal>
      )}
    </div>
  );
}
