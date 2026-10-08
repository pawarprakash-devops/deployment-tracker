'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { PipelineResponse } from '@/lib/pipeline-types';
import { usePipeline } from './ui';

export type Lens = 'dev' | 'qa' | 'rel' | 'mgmt';
export const LENSES: { id: Lens; label: string }[] = [
  { id: 'dev', label: 'Developer' },
  { id: 'qa', label: 'QA' },
  { id: 'rel', label: 'Release' },
  { id: 'mgmt', label: 'Management' },
];

interface Shell {
  lens: Lens;
  setLens: (l: Lens) => void;
  pipeline: PipelineResponse | null;
  error: string | null;
  updatedAt: number | null;
  openTicket: string | null;
  setOpenTicket: (key: string | null) => void;
}
const Ctx = createContext<Shell | null>(null);
export const useShell = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useShell outside ShellProvider');
  return c;
};

const LENS_KEY = 'tracker-lens';

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const { data, error, updatedAt } = usePipeline();
  const [lens, setLensState] = useState<Lens>('dev');
  const [openTicket, setOpenTicket] = useState<string | null>(null);

  useEffect(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get('as');
      const saved = fromUrl || localStorage.getItem(LENS_KEY);
      if (saved && LENSES.some((l) => l.id === saved)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only storage read after hydration
        setLensState(saved as Lens);
        if (fromUrl) localStorage.setItem(LENS_KEY, saved);
      }
    } catch { /* storage unavailable: keep default */ }
  }, []);

  const setLens = useCallback((l: Lens) => {
    setLensState(l);
    try { localStorage.setItem(LENS_KEY, l); } catch { /* ignore */ }
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('as', l);
      window.history.replaceState(null, '', u);
    } catch { /* ignore */ }
  }, []);

  const value = useMemo(
    () => ({ lens, setLens, pipeline: data, error, updatedAt, openTicket, setOpenTicket }),
    [lens, setLens, data, error, updatedAt, openTicket]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
