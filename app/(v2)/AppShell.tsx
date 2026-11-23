'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Rocket,
  BarChart3,
  Search,
  RefreshCw,
  Sun,
  Moon,
  Shield,
  Activity,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { useShell, type FleetCluster } from './ctx';
import { TABS, isTab, tabHref } from './tabs';
import CommandPalette from './CommandPalette';
import { useTilt3D } from './motion';

export default function AppShell({ children }: { children: React.ReactNode }) {
  useTilt3D();
  const rawTab = useSearchParams().get('tab');
  const tab = isTab(rawTab) ? rawTab : 'deployments';
  const {
    theme,
    toggleTheme,
    setSearchOpen,
    updatedAt,
    refresh,
    clusters,
    setClusters,
  } = useShell();

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // Check auth session
  useEffect(() => {
    fetch('/api/auth/session')
      .then((r) => r.json())
      .then((d) => setIsAdmin(!!d.authenticated))
      .catch(() => setIsAdmin(false));

    const onAuth = () => {
      fetch('/api/auth/session')
        .then((r) => r.json())
        .then((d) => setIsAdmin(!!d.authenticated))
        .catch(() => setIsAdmin(false));
    };
    window.addEventListener('tracker:auth-changed', onAuth);
    return () => window.removeEventListener('tracker:auth-changed', onAuth);
  }, []);

  // Fetch cluster health probes for topbar fleet summary
  useEffect(() => {
    let alive = true;
    const loadHealth = async () => {
      try {
        const res = await fetch('/api/cluster-health', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { clusters?: FleetCluster[] };
        if (alive && Array.isArray(data.clusters)) {
          setClusters(data.clusters);
        }
      } catch {
        /* ignore */
      }
    };
    loadHealth();
    const interval = setInterval(loadHealth, 90_000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [setClusters]);

  const handleManualRefresh = () => {
    setIsRefreshing(true);
    refresh();
    setTimeout(() => setIsRefreshing(false), 600);
  };

  // Fleet health calculation
  const totalClusters = clusters?.length ?? 0;
  const offlineCount = clusters?.filter((c) => c.status === 'OFFLINE').length ?? 0;
  const degradedCount = clusters?.filter((c) => c.status === 'DEGRADED').length ?? 0;
  const isAllHealthy = totalClusters > 0 && offlineCount === 0 && degradedCount === 0;

  return (
    <div className="v3" data-theme={theme}>
      <header className="topbar">
        <div className="topbar-left">
          <Link href="/" className="logo">
            <div className="logo-icon-wrap">
              <Rocket size={17} className="logo-icon" />
            </div>
            <span className="logo-text">
              <span className="logo-highlight">Vid</span>AI Delivery
            </span>
          </Link>

          {/* Fleet Health Quick Pill */}
          {totalClusters > 0 && (
            <div
              className={`fleet-health-pill ${
                offlineCount > 0 ? 'is-offline' : degradedCount > 0 ? 'is-degraded' : 'is-healthy'
              }`}
              title={
                isAllHealthy
                  ? `All ${totalClusters} environments online and responsive`
                  : `${offlineCount} offline, ${degradedCount} degraded of ${totalClusters}`
              }
            >
              <span className="fleet-health-dot" />
              <span className="fleet-health-text">
                {isAllHealthy ? (
                  <>
                    <CheckCircle2 size={12} className="inline-icon" />
                    <span>{totalClusters} Systems Healthy</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle size={12} className="inline-icon" />
                    <span>
                      {offlineCount > 0 ? `${offlineCount} Offline` : `${degradedCount} Degraded`}
                    </span>
                  </>
                )}
              </span>
            </div>
          )}
        </div>

        {/* Center Nav Tabs */}
        <nav className="tab-nav" aria-label="Main Navigation">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <Link
                key={t.id}
                href={tabHref(t.id)}
                className={`tab-link ${active ? 'is-active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                {t.id === 'deployments' ? (
                  <Rocket size={14} className="tab-icon" />
                ) : (
                  <BarChart3 size={14} className="tab-icon" />
                )}
                <span>{t.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Right Actions */}
        <div className="topbar-right">
          {/* Command Search Trigger */}
          <button
            type="button"
            className="search-trigger"
            onClick={() => setSearchOpen(true)}
            aria-label="Search deployments and actions (⌘K)"
          >
            <Search size={14} className="search-icon" />
            <span className="search-placeholder">Quick search...</span>
            <kbd className="search-kbd">⌘K</kbd>
          </button>

          {/* Refresh Button */}
          <button
            type="button"
            className="icon-btn"
            onClick={handleManualRefresh}
            title="Refresh fleet data"
            aria-label="Refresh data"
          >
            <RefreshCw size={14} className={isRefreshing ? 'spin' : ''} />
          </button>

          {/* Theme Toggle */}
          <button
            type="button"
            className="icon-btn"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>

          {/* Admin badge */}
          {isAdmin && (
            <div className="admin-status-badge" title="Operator mode active">
              <Shield size={12} />
              <span>Admin</span>
            </div>
          )}

          {/* Live updated stamp */}
          <div className="updated-stamp" suppressHydrationWarning>
            {updatedAt ? (
              <span>
                {new Date(updatedAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
            ) : (
              'Syncing...'
            )}
          </div>
        </div>
      </header>

      {/* Main Content View */}
      <main className="main-content" id="main">
        {children}
      </main>

      {/* Global ⌘K Command Palette */}
      <CommandPalette />
    </div>
  );
}
