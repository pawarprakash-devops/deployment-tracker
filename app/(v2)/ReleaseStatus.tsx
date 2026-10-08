'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useShell } from './ctx';

// Single focal banner: "is anything wrong right now?" Pipeline data comes from the shell; live probes are fetched here.
type Tone = 'ok' | 'warn' | 'bad' | 'info';
type Probe = { environment: string; status: 'HEALTHY' | 'DEGRADED' | 'OFFLINE'; latencyMs: number };
type Item = { key: string; name: string; tone: Tone; probeSeen: boolean };
type Issue = { name: string; tone: 'warn' | 'bad'; text: string; prod: boolean };

const VAR: Record<Tone, string> = { ok: '--ok', warn: '--warn', bad: '--bad', info: '--info' };
const GLYPH: Record<Tone, string> = { ok: '✓', warn: '!', bad: '✕', info: '↻' };
const STALE_DEPLOY_MS = 60 * 60 * 1000;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const isFailed = (s: string | undefined | null) => !!s && /fail|rolled/i.test(s);

function span(now: number, iso: string): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function scrollToEnv(name: string) {
  const el = document.getElementById(`env-${slug(name)}`);
  if (!el) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
}

export default function ReleaseStatus() {
  const { pipeline, updatedAt } = useShell();
  const [probes, setProbes] = useState<Probe[] | null>(null);
  const [probeAt, setProbeAt] = useState<number | null>(null);
  const [probeFailed, setProbeFailed] = useState(false);
  const [stamp, setStamp] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch('/api/cluster-health', { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as { clusters?: Probe[] };
        if (!alive) return;
        setProbes(Array.isArray(j.clusters) ? j.clusters : []);
        setProbeAt(Date.now());
        setProbeFailed(false);
      } catch {
        if (alive) setProbeFailed(true);
      }
    };
    load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 90_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // "now" is derived from data-arrival stamps so render stays pure.
  const now = Math.max(updatedAt ?? 0, probeAt ?? 0);

  const model = useMemo(() => {
    if (!pipeline) return null;
    const issues: Issue[] = [];
    const items: Item[] = [];
    const deploying: { name: string; startedAt: string }[] = [];
    const used = new Set<Probe>();
    const lat = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

    for (const c of pipeline.columns) {
      if (c.id === 'other') continue;
      const names = [c.name, ...c.environments].map(norm);
      const mine = (probes ?? []).filter((p) => names.includes(norm(p.environment)));
      mine.forEach((p) => used.add(p));
      let tone: Tone = 'ok';
      const bump = (t: Tone) => { if (t === 'bad' || (t === 'warn' && tone !== 'bad') || (t === 'info' && tone === 'ok')) tone = t; };
      const add = (text: string, bad: boolean) => {
        issues.push({ name: c.name, tone: bad ? 'bad' : 'warn', text, prod: c.isProduction });
        bump(bad ? 'bad' : 'warn');
      };
      for (const p of mine) {
        if (p.status === 'OFFLINE') add('probe offline', c.isProduction);
        else if (p.status === 'DEGRADED') add(`probe degraded ${lat(p.latencyMs)}`, false);
      }
      const latest = c.health.latest;
      if (latest && isFailed(latest.status)) add(`last deploy failed ${span(now, latest.at)}`, c.isProduction);
      if (c.activeDeploy) {
        deploying.push({ name: c.name, startedAt: c.activeDeploy.startedAt });
        if (now - new Date(c.activeDeploy.startedAt).getTime() > STALE_DEPLOY_MS) add(`deploy stale, started ${span(now, c.activeDeploy.startedAt)}`, false);
        else bump('info');
      }
      items.push({ key: c.id, name: c.name, tone, probeSeen: mine.length > 0 });
    }
    for (const p of probes ?? []) {
      if (used.has(p) || p.status === 'HEALTHY') continue;
      const prod = /^prod/i.test(p.environment);
      const bad = prod && p.status === 'OFFLINE';
      issues.push({ name: p.environment, tone: bad ? 'bad' : 'warn', text: p.status === 'OFFLINE' ? 'probe offline' : `probe degraded ${lat(p.latencyMs)}`, prod });
    }
    const prodCols = new Set(pipeline.columns.filter((c) => c.isProduction).map((c) => c.id));
    for (const t of pipeline.tickets) {
      if (!prodCols.has(t.column)) continue;
      const b = t.badges.find((x) => x.id === 'failed' || x.id === 'rolled_back');
      if (b) issues.push({ name: pipeline.columns.find((c) => c.id === t.column)?.name ?? 'Production', tone: 'bad', text: `${t.key} ${b.id === 'failed' ? 'failed' : 'rolled back'}`, prod: true });
    }
    issues.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'bad' ? -1 : 1));
    const envCount = new Set(issues.map((i) => i.name)).size;
    const anyBad = issues.some((i) => i.tone === 'bad');
    let tone: Tone = 'ok';
    let headline = `All ${items.length} environments healthy`;
    if (anyBad) { tone = 'bad'; headline = 'Production needs attention'; }
    else if (issues.length) { tone = 'warn'; headline = `${envCount} ${envCount === 1 ? 'environment needs' : 'environments need'} a look`; }
    else if (deploying.length) {
      tone = 'info';
      headline = deploying.length === 1 ? `${deploying[0].name} is deploying · started ${span(now, deploying[0].startedAt)}` : `${deploying.length} environments are deploying`;
    }
    return { tone, headline, issues, items };
  }, [pipeline, probes, now]);

  // Stamp "updated HH:MM" when data arrives (effect, not render).
  useEffect(() => {
    if (!now) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- timestamp formatting after data arrival
    setStamp(new Date(now).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
  }, [now]);

  // Only change live text when the headline string changes.
  const announced = useRef('');
  const [liveText, setLiveText] = useState('');
  const headline = model?.headline ?? '';
  useEffect(() => {
    if (headline && headline !== announced.current) {
      announced.current = headline;
      setLiveText(headline);
    }
  }, [headline]);

  if (!model) {
    return (
      <div className="status-banner" data-tone="info" aria-busy="true" style={{ minHeight: 64, padding: '14px 16px', borderRadius: 'var(--radius, 10px)', border: '1px solid var(--border, #ccc)', background: 'var(--surface-2, transparent)', opacity: 0.6 }}>
        <div style={{ height: 18, width: 220, borderRadius: 6, background: 'var(--border, #ccc)', marginBottom: 8 }} />
        <div style={{ height: 12, width: 340, maxWidth: '80%', borderRadius: 6, background: 'var(--border, #ccc)' }} />
      </div>
    );
  }

  const { tone, issues, items } = model;
  const shown = issues.slice(0, 3);
  const more = issues.length - shown.length;
  const pending = !probes && !probeFailed;
  const note = probeFailed && !probes ? 'probes unavailable' : pending ? 'probes pending' : null;

  return (
    <div
      className={`status-banner fade-in${tone === 'info' ? ' is-live' : ''}`}
      data-tone={tone}
      style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', justifyContent: 'space-between', padding: '14px 16px', borderRadius: 'var(--radius, 10px)', border: `1px solid var(${VAR[tone]}-border, var(${VAR[tone]}))`, background: `var(${VAR[tone]}-bg, transparent)`, color: 'var(--text, inherit)' }}
    >
      <div style={{ minWidth: 0, flex: '1 1 280px' }}>
        <div role="status" aria-live="polite" style={{ fontSize: 18, fontWeight: 650, color: `var(${VAR[tone]}-text, inherit)` }}>
          <span aria-hidden="true" style={{ marginRight: 8 }}>{GLYPH[tone]}</span>
          {liveText || headline}
        </div>
        <div style={{ marginTop: 4, fontSize: 13, color: 'var(--muted, inherit)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px 0' }}>
          {shown.map((i, n) => (
            <span key={`${i.name}-${i.text}`} style={{ display: 'inline-flex', alignItems: 'center' }}>
              {n > 0 && <span aria-hidden="true" style={{ margin: '0 6px' }}>·</span>}
              <button type="button" onClick={() => scrollToEnv(i.name)} title={`Go to ${i.name}`} style={{ all: 'unset', cursor: 'pointer', textDecoration: 'underline dotted', textUnderlineOffset: 3, color: 'inherit', borderRadius: 4 }}>
                {i.name}: {i.text}
              </button>
            </span>
          ))}
          {more > 0 && <span style={{ marginLeft: 6 }}>+{more} more</span>}
          {note && <span style={{ marginLeft: shown.length ? 8 : 0 }}>{shown.length ? '· ' : ''}{note}</span>}
          {!shown.length && !note && <span>No failures, offline probes or stuck deploys.</span>}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: 'var(--muted, inherit)' }}>
        <span className="mono" style={{ fontFamily: 'var(--font-mono, ui-monospace, monospace)' }}>{stamp ? `updated ${stamp}` : ''}</span>
        <span role="list" aria-label="Environment health" style={{ display: 'inline-flex', gap: 4 }}>
          {items.map((it) => {
            const label = `${it.name}: ${it.tone === 'ok' ? 'healthy' : it.tone === 'info' ? 'deploying' : it.tone === 'warn' ? 'needs a look' : 'needs attention'}${it.probeSeen ? '' : ' (no probe)'}`;
            return (
              <span key={it.key} role="listitem" title={label} aria-label={label} style={{ width: 16, height: 16, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, lineHeight: 1, background: `var(${VAR[it.tone]}-bg, transparent)`, color: `var(${VAR[it.tone]}-text, inherit)`, border: `1px solid var(${VAR[it.tone]}, currentColor)`, opacity: it.probeSeen ? 1 : 0.7 }}>
                <span aria-hidden="true">{GLYPH[it.tone]}</span>
              </span>
            );
          })}
        </span>
      </div>
    </div>
  );
}
