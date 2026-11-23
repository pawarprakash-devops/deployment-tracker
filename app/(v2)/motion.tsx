'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

// Motion helpers. Everything here turns itself off for viewers who prefer reduced motion.

const RM_QUERY = '(prefers-reduced-motion: reduce)';
function subscribeRM(cb: () => void) {
  const m = window.matchMedia(RM_QUERY);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
}
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeRM, () => window.matchMedia(RM_QUERY).matches, () => true);
}

// Mouse-follow 3D tilt for cards, via one delegated listener (no per-component wiring).
// Elements matching TILT_SELECTOR get --tilt-x / --tilt-y and the `is-tilting` class; CSS does the transform.
const TILT_SELECTOR = '.stat-card, .env-card, .metric-tile, .radar-card, .tilt-3d';
const MAX_DEG = 7;

export function useTilt3D() {
  useEffect(() => {
    if (window.matchMedia(RM_QUERY).matches || window.matchMedia('(hover: none)').matches) return;
    let current: HTMLElement | null = null;
    let raf = 0;
    const reset = (el: HTMLElement) => {
      el.style.removeProperty('--tilt-x');
      el.style.removeProperty('--tilt-y');
      el.classList.remove('is-tilting');
    };
    const move = (e: PointerEvent) => {
      const target = e.target instanceof Element ? (e.target.closest(TILT_SELECTOR) as HTMLElement | null) : null;
      if (current && current !== target) reset(current);
      current = target;
      if (!target) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = target.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        target.style.setProperty('--tilt-x', `${(-y * MAX_DEG).toFixed(2)}deg`);
        target.style.setProperty('--tilt-y', `${(x * MAX_DEG).toFixed(2)}deg`);
        target.classList.add('is-tilting');
      });
    };
    const leave = () => {
      if (current) reset(current);
      current = null;
    };
    document.addEventListener('pointermove', move, { passive: true });
    document.documentElement.addEventListener('pointerleave', leave);
    window.addEventListener('blur', leave);
    return () => {
      cancelAnimationFrame(raf);
      leave();
      document.removeEventListener('pointermove', move);
      document.documentElement.removeEventListener('pointerleave', leave);
      window.removeEventListener('blur', leave);
    };
  }, []);
}

// Animated number: counts from the previous value to the new one.
export function CountUp({ value, decimals = 0, suffix = '', duration = 900 }: { value: number; decimals?: number; suffix?: string; duration?: number }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (reduced) return;
    const start = from.current;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(start + (value - start) * eased);
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, reduced]);
  const n = reduced ? value : shown;
  return (
    <>
      {n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </>
  );
}
