'use client';
import { useEffect, useState } from 'react';
import type { EnvMetaRow } from '@/lib/env-meta';

// environments rows (incl. the self-registered metadata columns, null until an env's deploy sends a `tracker` block),
// fetched once per page load and shared by every component. null while loading or when the request failed: callers
// then use their built-in fallbacks.
let cache: Promise<Map<string, EnvMetaRow> | null> | null = null;

function loadEnvMeta(): Promise<Map<string, EnvMetaRow> | null> {
  cache ??= fetch('/api/environments')
    .then((r) => (r.ok ? (r.json() as Promise<unknown>) : null))
    .then((rows) => (Array.isArray(rows) ? new Map((rows as EnvMetaRow[]).filter((r) => r && typeof r.name === 'string').map((r) => [r.name, r])) : null))
    .catch(() => { cache = null; return null; });
  return cache;
}

export function useEnvMeta(): Map<string, EnvMetaRow> | null {
  const [meta, setMeta] = useState<Map<string, EnvMetaRow> | null>(null);
  useEffect(() => {
    let alive = true;
    loadEnvMeta().then((m) => { if (alive) setMeta(m); });
    return () => { alive = false; };
  }, []);
  return meta;
}
