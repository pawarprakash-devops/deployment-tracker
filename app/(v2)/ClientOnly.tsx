'use client';
import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

// The dashboard is fully client-driven (data arrives after mount), so rendering it during SSR /
// hydration only risks a mismatch when data lands before a deferred Suspense boundary hydrates.
// `false` is used on the server and during hydration, `true` afterwards.
export default function ClientOnly({ children }: { children: React.ReactNode }) {
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  return ready ? <>{children}</> : null;
}
