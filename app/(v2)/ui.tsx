'use client';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  PauseCircle,
  Loader2,
  RotateCcw,
  Ban,
  Radio,
} from 'lucide-react';

// ---- Formatting helpers ----------------------------------------------------------------------------

export function ago(iso: string | null | undefined): string {
  if (!iso) return '—';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function fmtDate(v: string | number | Date | null | undefined): string {
  if (v == null || v === '') return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function fmtDateTime(v: string | number | Date | null | undefined): string {
  if (v == null || v === '') return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });
}

export function formatDuration(sec?: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

// Ticking clock for components that need "now" without re-rendering every frame
export function useNow(intervalMs = 30000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [intervalMs]);
  return now;
}

// ---- Semantic status & typography types -------------------------------------------------------------

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';

export const QUEUED_GLYPH = '◷';
export const QUEUED_TEXT = 'Queued - waiting for previous deployment';
export const isQueuedStatus = (s: string | null | undefined) => !!s && /(^|\s)queued$/i.test(s.trim());

export const AWAITING_GLYPH = '⏸';
export const AWAITING_TEXT = 'Awaiting approval - waiting for DevOps approval';
export const isAwaitingStatus = (s: string | null | undefined) => !!s && /(^|\s)awaiting approval$/i.test(s.trim());

export const REJECTED_GLYPH = '⊘';
export const isRejectedStatus = (s: string | null | undefined) => !!s && /(^|\s)rejected$/i.test(s.trim());

// 8px status dot with subtle ripple pulse
export function LiveDot({ tone = 'info', label }: { tone?: Tone; label?: string }) {
  return (
    <span
      className={`live-dot tone-${tone}`}
      role="status"
      aria-label={label}
      title={label}
    />
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="tracker-kbd">{children}</kbd>;
}

export function EnvDot({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className={`envdot tone-${tone}`} role="img" aria-label={label} title={label}>
      <span className="dot-inner" />
    </span>
  );
}

export function Chip({ children, title, variant = 'neutral' }: { children: ReactNode; title?: string; variant?: 'neutral' | 'fe' | 'be' | 'prod' }) {
  return (
    <span className={`vchip chip-${variant} tnum`} title={title}>
      {children}
    </span>
  );
}

export function Pill({
  tone = 'neutral',
  children,
  icon,
  live = false,
  glyph,
}: {
  tone?: Tone;
  children: ReactNode;
  icon?: ReactNode;
  live?: boolean;
  glyph?: string;
}) {
  return (
    <span className={`pill tone-${tone} ${live ? 'is-live' : ''}`}>
      {icon ? (
        <span className="pill-icon">{icon}</span>
      ) : live ? (
        <Loader2 className="pill-icon spin" size={13} />
      ) : glyph ? (
        <span className="pill-glyph">{glyph}</span>
      ) : tone === 'ok' ? (
        <CheckCircle2 className="pill-icon" size={13} />
      ) : tone === 'warn' ? (
        <AlertTriangle className="pill-icon" size={13} />
      ) : tone === 'bad' ? (
        <XCircle className="pill-icon" size={13} />
      ) : (
        <Radio className="pill-icon" size={13} />
      )}
      <span className="pill-text">{children}</span>
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (isAwaitingStatus(s)) {
    return (
      <Pill tone="info" icon={<PauseCircle size={13} />}>
        Awaiting approval
      </Pill>
    );
  }
  if (isRejectedStatus(s)) {
    return (
      <Pill tone="warn" icon={<Ban size={13} />}>
        Rejected
      </Pill>
    );
  }
  if (isQueuedStatus(s)) {
    return (
      <Pill tone="warn" icon={<Clock size={13} />}>
        Queued
      </Pill>
    );
  }
  if (/progress/.test(s)) {
    return (
      <Pill tone="info" live>
        In Progress
      </Pill>
    );
  }
  if (/success/.test(s)) {
    return (
      <Pill tone="ok" icon={<CheckCircle2 size={13} />}>
        {status}
      </Pill>
    );
  }
  if (/fail/.test(s)) {
    return (
      <Pill tone="bad" icon={<XCircle size={13} />}>
        {status}
      </Pill>
    );
  }
  if (/roll/.test(s)) {
    return (
      <Pill tone="warn" icon={<RotateCcw size={13} />}>
        {status}
      </Pill>
    );
  }
  return <Pill tone="neutral">{status}</Pill>;
}

// Modern Metric Tile with trend hint and icon support
export function Tile({
  label,
  value,
  hint,
  tone,
  icon,
  children,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={`metric-tile ${tone ? `tone-${tone}` : ''}`}>
      <div className="tile-header">
        <span className="tile-label">{label}</span>
        {icon && <span className="tile-icon">{icon}</span>}
      </div>
      <div className="tile-value tnum">{value}</div>
      {children}
      {hint != null && <div className="tile-hint">{hint}</div>}
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

export function Card({
  title,
  subtitle,
  badge,
  action,
  children,
  className = '',
}: {
  title?: string;
  subtitle?: string;
  badge?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`tracker-card ${className}`}>
      {(title || action || subtitle || badge) && (
        <div className="card-header">
          <div>
            <div className="card-title-row">
              {title && <h2 className="card-title">{title}</h2>}
              {badge}
            </div>
            {subtitle && <p className="card-subtitle">{subtitle}</p>}
          </div>
          {action && <div className="card-action">{action}</div>}
        </div>
      )}
      <div className="card-body">{children}</div>
    </section>
  );
}

export function Empty({
  children,
  icon,
  title,
  action,
}: {
  children: ReactNode;
  icon?: ReactNode;
  title?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="tracker-empty">
      {icon && <div className="empty-icon">{icon}</div>}
      {title && <h3 className="empty-title">{title}</h3>}
      <p className="empty-desc">{children}</p>
      {action && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}

export function Skeleton({
  rows = 3,
  variant = 'lines',
  height,
}: {
  rows?: number;
  variant?: 'lines' | 'rows' | 'tile';
  height?: number;
}) {
  if (variant === 'tile') {
    return (
      <div className="skeleton-wrap" aria-busy="true">
        <div className="skeleton-bar" style={{ height: height ?? 88, borderRadius: 10 }} />
      </div>
    );
  }
  if (variant === 'rows') {
    return (
      <div className="skeleton-wrap" aria-busy="true">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="skeleton-bar" style={{ height: height ?? 44, margin: '8px 0', borderRadius: 8 }} />
        ))}
      </div>
    );
  }
  return (
    <div className="skeleton-wrap" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="skeleton-bar"
          style={{ height: height ?? 16, margin: '10px 0', width: `${95 - i * 15}%`, borderRadius: 4 }}
        />
      ))}
    </div>
  );
}

export function ErrorNote({
  children,
  onRetry,
  detail,
}: {
  children: ReactNode;
  onRetry?: () => void;
  detail?: string;
}) {
  return (
    <div className="banner banner-error" role="alert">
      <div className="banner-content">
        <AlertTriangle className="banner-icon" size={16} />
        <div>
          <div className="banner-msg">{children}</div>
          {detail && <div className="banner-detail">{detail}</div>}
        </div>
      </div>
      {onRetry && (
        <button type="button" className="btn btn-sm btn-secondary" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
