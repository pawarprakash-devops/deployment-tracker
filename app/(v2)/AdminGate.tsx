'use client';
import { useCallback, useEffect, useState } from 'react';
import { Skeleton } from './ui';

// Wraps content that needs an admin session (Tickets, Insights). Anyone else gets a sign-in card.
// Signing in dispatches the same `tracker:auth-changed` event the toolbar uses, so every
// component that cares about the session refreshes.
// `publicUrl` (optional): an endpoint returning `{ public: boolean }`. When it says true the content is shown to
// everyone and no sign-in card appears (used by the Tickets tab, whose Jira data is public unless JIRA_PUBLIC_READ=false).
export default function AdminGate({ title, publicUrl, children }: { title: string; publicUrl?: string; children: React.ReactNode }) {
  const [state, setState] = useState<'loading' | 'admin' | 'viewer'>('loading');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    if (publicUrl) {
      try {
        const p = await fetch(publicUrl, { cache: 'no-store' });
        if (p.ok && (await p.json())?.public === true) { setState('admin'); return; }
      } catch { /* fall through to the session check */ }
    }
    try {
      const r = await fetch('/api/auth/session', { cache: 'no-store' });
      const j = await r.json();
      setState(j?.role === 'admin' ? 'admin' : 'viewer');
    } catch {
      setState('viewer');
    }
  }, [publicUrl]);

  useEffect(() => {
    // initial session check on mount, then follow sign-in/out from anywhere in the app
    const t = setTimeout(() => void check(), 0);
    const on = () => void check();
    window.addEventListener('tracker:auth-changed', on);
    return () => { clearTimeout(t); window.removeEventListener('tracker:auth-changed', on); };
  }, [check]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError('');
    const pw = password;
    setPassword('');
    try {
      const r = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
      if (!r.ok) {
        setError(r.status === 429 ? 'Too many attempts. Try again in a minute.' : r.status >= 500 ? 'The server could not check the password. Try again.' : 'Wrong password.');
      } else {
        window.dispatchEvent(new CustomEvent('tracker:auth-changed'));
        await check();
      }
    } catch {
      setError('Network error. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (state === 'loading') return <Skeleton rows={4} />;
  if (state === 'admin') return <>{children}</>;
  return (
    <section className="card" style={{ maxWidth: 420 }} aria-label={`${title} sign-in`}>
      <div className="card-h"><h2>{title}</h2></div>
      <p className="muted" style={{ marginTop: 0 }}>This page shows internal data, so it needs an admin sign-in.</p>
      <form onSubmit={submit} style={{ display: 'grid', gap: 10 }}>
        <label htmlFor="gate-pw" className="muted" style={{ fontSize: 'var(--fs-xs)' }}>Admin password</label>
        <input id="gate-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ minWidth: 0 }} />
        {error && <div className="banner" role="alert" style={{ margin: 0 }}>{error}</div>}
        <button type="submit" className="btn" disabled={busy || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </section>
  );
}
