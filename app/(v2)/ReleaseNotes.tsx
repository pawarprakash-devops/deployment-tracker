'use client';
import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Download, Loader2 } from 'lucide-react';
import { Modal } from './ReleaseAdmin';

interface Commit { sha: string; message: string; author?: string; url: string }
interface RepoNotes { repo: 'backend' | 'frontend'; slug: string | null; total: number; commits: Commit[]; truncated: boolean; error?: string }

const GROUPS: { key: string; title: string; match: RegExp }[] = [
  { key: 'feat', title: '✨ Features', match: /^(feat|feature|enhancement)\b/i },
  { key: 'fix', title: '🐛 Fixes', match: /^(fix|bugfix|hotfix)\b/i },
  { key: 'perf', title: '⚡ Performance', match: /^perf\b/i },
  { key: 'refactor', title: '♻️ Refactors', match: /^refactor\b/i },
  { key: 'chore', title: '🧹 Chores, CI & docs', match: /^(chore|ci|build|docs|test|style)\b/i },
];
const groupOf = (msg: string) => GROUPS.find((g) => g.match.test(msg))?.key ?? 'other';
const prOf = (msg: string) => (/\(#(\d+)\)\s*$/.exec(msg) ?? /^Merge pull request #(\d+)/.exec(msg))?.[1] ?? null;
const clean = (msg: string) => msg.replace(/^(\w+)(\([^)]*\))?!?\s*[:/]\s*/, '').trim() || msg;
const isNoise = (msg: string) => /^Merge (branch|remote-tracking branch)\b/.test(msg);
const slugFrom = (url?: string) => (url ? /github\.com\/([^/]+\/[^/]+)\/compare/.exec(url)?.[1] ?? null : null);

function toMarkdown(fromEnv: string, toEnv: string, notes: RepoNotes[]): string {
  const day = new Date().toISOString().slice(0, 10);
  const out = [`## Release: ${fromEnv} → ${toEnv} (${day})`, ''];
  for (const n of notes) {
    const label = n.repo === 'backend' ? 'Backend' : 'Frontend';
    if (n.error) { out.push(`### ${label}`, `_Could not load: ${n.error}_`, ''); continue; }
    const list = n.commits.filter((c) => !isNoise(c.message));
    out.push(`### ${label}${n.slug ? ` (${n.slug})` : ''}: ${n.total} commit${n.total === 1 ? '' : 's'}`);
    if (!list.length) { out.push('_Nothing waiting._', ''); continue; }
    for (const g of [...GROUPS, { key: 'other', title: '📦 Other changes', match: /.^/ }]) {
      const items = list.filter((c) => groupOf(c.message) === g.key);
      if (!items.length) continue;
      out.push(`**${g.title}**`);
      for (const c of items) {
        const pr = prOf(c.message);
        const link = pr && n.slug ? ` ([#${pr}](https://github.com/${n.slug}/pull/${pr}))` : pr ? ` (#${pr})` : '';
        out.push(`- ${clean(c.message).replace(/\s*\(#\d+\)\s*$/, '')}${link}${c.author ? ` · ${c.author}` : ''}`);
      }
    }
    if (n.truncated) out.push(`_…showing the newest ${n.commits.length} of ${n.total}._`);
    out.push('');
  }
  return out.join('\n');
}

// Copy-ready changelog of everything waiting between two promotion stages, for both repos.
export default function ReleaseNotes({ from, base, fromEnv, toEnv, onClose }: { from: string; base: string; fromEnv: string; toEnv: string; onClose: () => void }) {
  const [notes, setNotes] = useState<RepoNotes[] | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all((['backend', 'frontend'] as const).map(async (repo): Promise<RepoNotes> => {
      try {
        const r = await fetch(`/api/drift/commits?repo=${repo}&base=${encodeURIComponent(base)}&head=${encodeURIComponent(from)}`, { cache: 'no-store' });
        const d = await r.json();
        if (!r.ok) return { repo, slug: null, total: 0, commits: [], truncated: false, error: d.error ?? `HTTP ${r.status}` };
        return { repo, slug: slugFrom(d.compareUrl), total: d.total ?? 0, commits: d.commits ?? [], truncated: !!d.truncated };
      } catch (e) {
        return { repo, slug: null, total: 0, commits: [], truncated: false, error: e instanceof Error ? e.message : 'failed' };
      }
    })).then((x) => { if (live) setNotes(x); });
    return () => { live = false; };
  }, [from, base]);

  const md = useMemo(() => (notes ? toMarkdown(fromEnv, toEnv, notes) : ''), [notes, fromEnv, toEnv]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(md); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked */ }
  };
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    a.download = `release-${fromEnv}-to-${toEnv}-${new Date().toISOString().slice(0, 10)}.md`.replace(/[^\w.-]+/g, '-');
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Modal
      title={`📝 Release notes · ${fromEnv} → ${toEnv}`}
      onClose={onClose}
      footer={notes && (
        <>
          <button type="button" className="btn btn-secondary btn-sm" onClick={download}><Download size={13} /> Download .md</button>
          <button type="button" className="btn btn-sm" onClick={copy} data-autofocus>{copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy for Slack</>}</button>
        </>
      )}
    >
      {!notes ? (
        <div className="release-notes-loading"><Loader2 size={16} className="spin" /> Collecting commits from both repos…</div>
      ) : (
        <pre className="release-notes-pre">{md}</pre>
      )}
    </Modal>
  );
}
