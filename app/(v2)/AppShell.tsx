'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { LENSES, useShell } from './ctx';
import TicketDrawer from './TicketDrawer';
import { TABS, isTab, tabHref } from './tabs';
import { EnvDot, type Tone } from './ui';

type ThemeMode = 'light' | 'dark' | null;

export default function AppShell({ children }: { children: React.ReactNode }) {
  const rawTab = useSearchParams().get('tab');
  const tab = isTab(rawTab) ? rawTab : 'deployments';
  const { lens, setLens, pipeline, updatedAt } = useShell();
  const [theme, setTheme] = useState<ThemeMode>(null);
  const searchRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('tracker-theme');
      // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only storage read after hydration
      if (saved === 'light' || saved === 'dark') setTheme(saved);
    } catch { /* ignore */ }
  }, []);
  const toggleTheme = () => {
    const dark = theme ? theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    const next: ThemeMode = dark ? 'light' : 'dark';
    setTheme(next);
    try { localStorage.setItem('tracker-theme', next as string); } catch { /* ignore */ }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchRef.current?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const dots = (pipeline?.columns ?? []).map((c) => {
    const s = (c.health.latest?.status ?? '').toLowerCase();
    const tone: Tone = !s ? 'neutral' : /fail/.test(s) ? 'bad' : /progress/.test(s) ? 'info' : /success/.test(s) ? 'ok' : 'warn';
    return { id: c.id, tone, label: `${c.name}: ${c.health.latest?.status ?? 'no deployments'}` };
  });

  return (
    <div className="v2" data-theme={theme ?? undefined}>
      <div className="app">
        <header className="topbar">
          <span className="logo"><b>Vid</b>AI Delivery</span>
          {tab === 'my-view' && (
            <div className="lens" role="group" aria-label="Role lens">
              {LENSES.map((l) => (
                <button key={l.id} aria-pressed={lens === l.id} onClick={() => setLens(l.id)}>{l.label}</button>
              ))}
            </div>
          )}
          <span className="spacer" />
          <button className="search" ref={searchRef} aria-label="Search tickets, versions, branches (coming soon)">Search ticket, version…<kbd>⌘K</kbd></button>
          <div className="dots" aria-label="Environment health">{dots.map((d) => <EnvDot key={d.id} tone={d.tone} label={d.label} />)}</div>
          <span className="muted tnum" style={{ fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap' }} suppressHydrationWarning>
            {updatedAt ? `updated ${new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'loading…'}
          </span>
          <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle light or dark theme">Theme</button>
        </header>
        <nav className="nav" aria-label="Main">
          {TABS.map((t) => <Link key={t.id} href={tabHref(t.id)} aria-current={tab === t.id ? 'page' : undefined}>{t.label}</Link>)}
        </nav>
        <main className="main" id="main">{children}</main>
      </div>
      <TicketDrawer />
    </div>
  );
}
