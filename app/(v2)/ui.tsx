'use client';
import { useEffect, useState } from 'react';
import type { PipelineResponse } from '@/lib/pipeline-types';

// ---- shared data hook ----------------------------------------------------------------------------
export function usePipeline() {
  const [data, setData] = useState<PipelineResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch('/api/pipeline', { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as PipelineResponse;
        if (alive) { setData(j); setError(null); setUpdatedAt(Date.now()); }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load');
      }
    };
    load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 90_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return { data, error, updatedAt };
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

// ---- components ----------------------------------------------------------------------------------
export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';
const ICON: Record<Tone, string> = { ok: '✓', warn: '!', bad: '✕', info: '●', neutral: '○' };

export function Pill({ tone = 'neutral', children, icon = true }: { tone?: Tone; children: React.ReactNode; icon?: boolean }) {
  return (
    <span className="pill" style={{ color: `var(--${tone}-text)`, background: `var(--${tone}-bg)`, border: `1px solid var(--${tone}-border)` }}>
      {icon && <span aria-hidden="true">{ICON[tone]}</span>}
      {children}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  const s = status.toLowerCase();
  const tone: Tone = /success/.test(s) ? 'ok' : /progress/.test(s) ? 'info' : /fail/.test(s) ? 'bad' : /roll|cancel/.test(s) ? 'warn' : 'neutral';
  return <Pill tone={tone}>{status}</Pill>;
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

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return <div aria-busy="true" aria-label="Loading">{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ height: 18, margin: '10px 0', width: `${90 - i * 12}%` }} />)}</div>;
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return <div className="banner" role="alert">{children}</div>;
}

export function JiraNote({ configured }: { configured: boolean }) {
  return (
    <div className="banner info" role="note">
      {configured ? 'Jira titles and assignees show after admin sign-in.' : 'Jira is not configured on this server, so tickets appear by key only.'}
    </div>
  );
}
