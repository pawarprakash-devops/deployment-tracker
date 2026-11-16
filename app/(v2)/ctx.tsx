'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export interface FleetCluster {
  environment: string;
  url?: string;
  status: 'HEALTHY' | 'DEGRADED' | 'OFFLINE';
  latencyMs: number;
  message?: string;
}

export interface ShellContextType {
  updatedAt: number | null;
  refreshKey: number;
  refresh: () => void;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  envFilter: string | null;
  setEnvFilter: (env: string | null) => void;
  statusFilter: string | null;
  setStatusFilter: (status: string | null) => void;
  clusters: FleetCluster[] | null;
  setClusters: (clusters: FleetCluster[] | null) => void;
}

const ShellCtx = createContext<ShellContextType | null>(null);

export function useShell(): ShellContextType {
  const ctx = useContext(ShellCtx);
  if (!ctx) throw new Error('useShell must be used within ShellProvider');
  return ctx;
}

const THEME_KEY = 'tracker-theme';

export function ShellProvider({ children }: { children: ReactNode }) {
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [searchOpen, setSearchOpen] = useState(false);
  const [envFilter, setEnvFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [clusters, setClusters] = useState<FleetCluster[] | null>(null);

  // Initialize theme from localStorage or OS preference
  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark') {
        setTheme(saved);
      } else if (window.matchMedia('(prefers-color-scheme: light)').matches) {
        setTheme('light');
      }
    } catch {
      /* ignore */
    }
    setUpdatedAt(Date.now());
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    setUpdatedAt(Date.now());
    window.dispatchEvent(new CustomEvent('tracker:refresh'));
  }, []);

  // Periodic automatic refresh every 60s when visible
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        refresh();
      }
    }, 60_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const value = useMemo(
    () => ({
      updatedAt,
      refreshKey,
      refresh,
      theme,
      toggleTheme,
      searchOpen,
      setSearchOpen,
      envFilter,
      setEnvFilter,
      statusFilter,
      setStatusFilter,
      clusters,
      setClusters,
    }),
    [updatedAt, refreshKey, refresh, theme, toggleTheme, searchOpen, envFilter, statusFilter, clusters]
  );

  return <ShellCtx.Provider value={value}>{children}</ShellCtx.Provider>;
}
