'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { PipelineResponse } from '@/lib/pipeline-types';

// ---- shared data hook ----------------------------------------------------------------------------
export function usePipeline() {
  const [data, setData] = useState<PipelineResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const alive = useRef(true);
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/pipeline', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as PipelineResponse;
      if (alive.current) { setData(j); setError(null); setUpdatedAt(Date.now()); }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    const first = setTimeout(() => { void load(); }, 0);
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 90_000);
    return () => { alive.current = false; clearTimeout(first); clearInterval(t); };
  }, [load]);
  const refresh = useCallback(() => { void load(); }, [load]);
  return { data, error, updatedAt, refresh };
}

// Ticking clock for components that need "now" without calling Date.now() during render.
// Returns null until mounted, then the current timestamp, refreshed every `intervalMs`.
export function useNow(intervalMs = 30000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [intervalMs]);
  return now;
}

// ---- formatting ----------------------------------------------------------------------------------
export function ago(iso: string | null | undefined): string {
  if (!iso) return '—';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Dates are shown as dd/mm/yyyy (and "dd/mm/yyyy, h:mm:ss am" with a time), in the viewer's time zone.
export function fmtDate(v: string | number | Date | null | undefined): string {
  if (v == null || v === '') return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
export function fmtDateTime(v: string | number | Date | null | undefined): string {
  if (v == null || v === '') return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
}

// ---- components ----------------------------------------------------------------------------------
export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';
const ICON: Record<Tone, string> = { ok: '✓', warn: '!', bad: '✕', info: '●', neutral: '○' };

const SR_ONLY: React.CSSProperties = { position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 };

// 8px status dot; the `.is-live` class (shell.css) adds the pulse. Label is read by screen readers only.
export function LiveDot({ tone = 'info', label }: { tone?: Tone; label?: string }) {
  return (
    <span className="is-live" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', flex: 'none', background: `var(--${tone})` }}>
      {label && <span style={SR_ONLY}>{label}</span>}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="mono" style={{ display: 'inline-block', padding: '1px 5px', minWidth: 18, textAlign: 'center', fontSize: 11, lineHeight: '16px', color: 'var(--muted, inherit)', background: 'var(--surface-2, transparent)', border: '1px solid var(--border, currentColor)', borderRadius: 4 }}>{children}</kbd>
  );
}

export function Pill({ tone = 'neutral', children, icon = true, live = false, glyph }: { tone?: Tone; children: React.ReactNode; icon?: boolean; live?: boolean; glyph?: string }) {
  return (
    <span className="pill" style={{ color: `var(--${tone}-text)`, background: `var(--${tone}-bg)`, border: `1px solid var(--${tone}-border)` }}>
      {live ? <span aria-hidden="true" style={{ display: 'inline-flex' }}><LiveDot tone={tone} /></span> : icon && <span aria-hidden="true">{glyph ?? ICON[tone]}</span>}
      {children}
    </span>
  );
}

export const QUEUED_GLYPH = '◷';
export const QUEUED_TEXT = 'Queued - waiting for previous deployment';
export const isQueuedStatus = (s: string | null | undefined) => !!s && /(^|\s)queued$/i.test(s.trim());

export function StatusPill({ status }: { status: string }) {
  const s = status.toLowerCase();
  // 'Queued' / 'Rerun - Queued': waiting behind a running deploy. Warn tone + a clock glyph (not the '!' of rolled back/cancelled).
  if (isQueuedStatus(s)) return <Pill tone="warn" glyph={QUEUED_GLYPH}>Queued</Pill>;
  const tone: Tone = /success/.test(s) ? 'ok' : /progress/.test(s) ? 'info' : /fail/.test(s) ? 'bad' : /roll|cancel/.test(s) ? 'warn' : 'neutral';
  return <Pill tone={tone} live={/progress/.test(s)}>{status}</Pill>;
}

export function EnvDot({ tone, label }: { tone: Tone; label: string }) {
  return <span className="envdot" role="img" aria-label={label} title={label} style={{ background: `var(--${tone})` }}><span aria-hidden="true">{ICON[tone]}</span></span>;
}

export function Chip({ children, title }: { children: React.ReactNode; title?: string }) {
  return <span className="vchip tnum" title={title}>{children}</span>;
}

export function Tile({ label, value, hint, tone, children }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: Tone; children?: React.ReactNode }) {
  return (
    <div className="card tile">
      <div className="tile-l">{label}</div>
      <div className="tile-v tnum" style={tone ? { color: `var(--${tone}-text)` } : undefined}>{value}</div>
      {children}
      {hint != null && <div className="tile-h">{hint}</div>}
    </div>
  );
}

export function Spark({ points, label }: { points: number[]; label: string }) {
  if (points.length < 2) return null;
  const max = Math.max(...points, 1);
  const pts = points.map((p, i) => `${(i * 100) / (points.length - 1)},${26 - (p / max) * 24}`).join(' ');
  return (
    <svg className="spark" viewBox="0 0 100 28" preserveAspectRatio="none" role="img" aria-label={label}>
      <polyline fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" points={pts} />
    </svg>
  );
}

export function Card({ title, action, children }: { title?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card">
      {(title || action) && (
        <div className="card-h"><h2>{title}</h2>{action}</div>
      )}
      {children}
    </section>
  );
}

export function Empty({ children, icon, title, action }: { children: React.ReactNode; icon?: ReactNode; title?: string; action?: { label: string; onClick: () => void } }) {
  if (icon == null && !title && !action) return <p className="empty">{children}</p>;
  return (
    <div className="empty fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6, textAlign: 'left' }}>
      {icon != null && <span aria-hidden="true" style={{ fontSize: 20, lineHeight: 1, opacity: 0.8 }}>{icon}</span>}
      {title && <strong style={{ fontSize: 14, color: 'var(--text, inherit)' }}>{title}</strong>}
      <p style={{ margin: 0 }}>{children}</p>
      {action && <button type="button" className="btn" onClick={action.onClick} style={{ marginTop: 4 }}>{action.label}</button>}
    </div>
  );
}

export function Skeleton({ rows = 3, variant = 'lines', height }: { rows?: number; variant?: 'lines' | 'rows' | 'tile'; height?: number }) {
  if (variant === 'tile') {
    return <div aria-busy="true" aria-label="Loading"><div className="skeleton" style={{ height: height ?? 88, borderRadius: 8 }} /></div>;
  }
  if (variant === 'rows') {
    return (
      <div aria-busy="true" aria-label="Loading">
        {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ height: height ?? 40, margin: '8px 0', width: '100%', borderRadius: 6 }} />)}
      </div>
    );
  }
  return <div aria-busy="true" aria-label="Loading">{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ height: height ?? 18, margin: '10px 0', width: `${90 - i * 12}%` }} />)}</div>;
}

export function ErrorNote({ children, onRetry, detail }: { children: React.ReactNode; onRetry?: () => void; detail?: string }) {
  if (!onRetry && !detail) return <div className="banner" role="alert">{children}</div>;
  return (
    <div className="banner" role="alert" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <div>
        <div>{children}</div>
        {detail && <div style={{ marginTop: 2, fontSize: 12, opacity: 0.8 }}>{detail}</div>}
      </div>
      {onRetry && <button type="button" className="btn" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function JiraNote({ configured }: { configured: boolean }) {
  return (
    <div className="banner info" role="note">
      {configured ? 'Jira titles and assignees show after admin sign-in.' : 'Jira is not configured on this server, so tickets appear by key only.'}
    </div>
  );
}
