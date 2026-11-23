'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  GitPullRequest,
  GitCommit,
  Clock,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  Layers,
  Sparkles,
} from 'lucide-react';
import { useShell } from './ctx';
import RadarScope from './RadarScope';
import ReleaseNotes from './ReleaseNotes';

type Repo = 'backend' | 'frontend';

interface Commit {
  sha: string;
  message: string;
  author?: string;
  url: string;
}

interface Pair {
  baseRef?: string;
  from: string;
  to: string;
  fromEnv: string;
  toEnv: string;
  pending?: number;
  error?: string;
  missingBranch?: string;
}

interface CommitDetail {
  loading: boolean;
  error?: string;
  commits: Commit[];
  total: number;
  compareUrl?: string;
}

const WINDOWS = [
  { label: '1:30 PM IST', start: 13.5 * 3600 },
  { label: '4:00 PM IST', start: 16.0 * 3600 },
];

function istSecondsNow(): number {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60_000;
  const ist = new Date(utc + 5.5 * 3600_000);
  return ist.getHours() * 3600 + ist.getMinutes() * 60 + ist.getSeconds();
}

function nextWindowText(): string {
  const secs = istSecondsNow();
  for (const w of WINDOWS) {
    if (secs < w.start) {
      const diff = w.start - secs;
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      return `${w.label} (in ${h > 0 ? `${h}h ` : ''}${m}m)`;
    }
  }
  // Past today's windows: next is 1:30 PM tomorrow
  const diff = 86400 - secs + WINDOWS[0].start;
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  return `Tomorrow 1:30 PM IST (in ${h}h ${m}m)`;
}

export default function ReleaseRadar() {
  const { refreshKey } = useShell();
  const [repo, setRepo] = useState<Repo>('backend');
  const [pairs, setPairs] = useState<Pair[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openPairKey, setOpenPairKey] = useState<string | null>(null);
  const [detailMap, setDetailMap] = useState<Record<string, CommitDetail>>({});
  const [windowNotice, setWindowNotice] = useState('');
  const [notesFor, setNotesFor] = useState<Pair | null>(null);

  // Update QA window countdown
  useEffect(() => {
    setWindowNotice(nextWindowText());
    const t = setInterval(() => setWindowNotice(nextWindowText()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Fetch drift pairs
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/drift?repo=${repo}`, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (alive) {
          if (Array.isArray(d.pairs)) {
            setPairs(d.pairs);
            setError(null);
          } else {
            setError(d.error || 'Invalid drift response');
          }
          setLoading(false);
        }
      })
      .catch((e) => {
        if (alive) {
          setError(e instanceof Error ? e.message : 'Failed to fetch drift');
          setLoading(false);
        }
      });

    return () => {
      alive = false;
    };
  }, [repo, refreshKey]);

  const togglePair = useCallback(
    (p: Pair) => {
      const key = `${p.from}>${p.to}`;
      if (openPairKey === key) {
        setOpenPairKey(null);
        return;
      }
      setOpenPairKey(key);

      // If already fetched, don't refetch
      if (detailMap[key] && !detailMap[key].loading) return;

      setDetailMap((prev) => ({
        ...prev,
        [key]: { loading: true, commits: [], total: p.pending ?? 0 },
      }));

      const base = p.baseRef || p.to;
      fetch(
        `/api/drift/commits?repo=${repo}&base=${encodeURIComponent(base)}&head=${encodeURIComponent(
          p.from
        )}`
      )
        .then((r) => r.json())
        .then((d) => {
          setDetailMap((prev) => ({
            ...prev,
            [key]: {
              loading: false,
              commits: d.commits || [],
              total: d.total ?? p.pending ?? 0,
              compareUrl: d.compareUrl,
              error: d.error,
            },
          }));
        })
        .catch((e) => {
          setDetailMap((prev) => ({
            ...prev,
            [key]: {
              loading: false,
              commits: [],
              total: p.pending ?? 0,
              error: e instanceof Error ? e.message : 'Failed to load commits',
            },
          }));
        });
    },
    [openPairKey, detailMap, repo]
  );

  return (
    <div className="radar-section">
      <div className="section-header">
        <div>
          <h2 className="section-title">Promotion Radar &amp; Drift</h2>
          <p className="section-subtitle">
            Unpromoted upstream commits awaiting release across promotion stages
          </p>
        </div>

        <div className="radar-header-actions">
          {/* QA Window Notice */}
          <div className="qa-window-badge" title="Target deploy windows for QA validation">
            <Clock size={13} className="text-accent" />
            <span>Next QA Window:</span>
            <strong>{windowNotice}</strong>
          </div>

          {/* Repo Switcher */}
          <div className="repo-toggle-group">
            <button
              type="button"
              className={`repo-btn ${repo === 'backend' ? 'is-active' : ''}`}
              onClick={() => {
                setRepo('backend');
                setOpenPairKey(null);
              }}
            >
              Backend
            </button>
            <button
              type="button"
              className={`repo-btn ${repo === 'frontend' ? 'is-active' : ''}`}
              onClick={() => {
                setRepo('frontend');
                setOpenPairKey(null);
              }}
            >
              Frontend
            </button>
          </div>
        </div>
      </div>

      {loading && !pairs ? (
        <div className="radar-loading">
          <Loader2 size={18} className="spin text-muted" />
          <span>Analyzing promotion branch drift for {repo}...</span>
        </div>
      ) : error ? (
        <div className="radar-empty">
          <p className="text-danger">{error}</p>
        </div>
      ) : (
        <>
        <RadarScope
          pairs={(pairs ?? []).map((p) => ({ key: `${p.from}>${p.to}`, fromEnv: p.fromEnv, toEnv: p.toEnv, pending: p.pending, error: p.error, missingBranch: p.missingBranch }))}
          openKey={openPairKey}
          onSelect={(key) => {
            const p = pairs?.find((x) => `${x.from}>${x.to}` === key);
            if (p) togglePair(p);
            document.getElementById(`radar-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }}
        />
        <div className="radar-grid">
          {pairs?.map((p) => {
            const pairKey = `${p.from}>${p.to}`;
            const isOpen = openPairKey === pairKey;
            const detail = detailMap[pairKey];
            const hasPending = (p.pending ?? 0) > 0;

            return (
              <div
                key={pairKey}
                id={`radar-${pairKey}`}
                className={`radar-card ${hasPending ? 'has-drift' : 'is-synced'} ${
                  isOpen ? 'is-expanded' : ''
                }`}
              >
                <div className="radar-card-main" onClick={() => togglePair(p)}>
                  <div className="radar-stages">
                    <div className="radar-stage">
                      <span className="stage-env">{p.fromEnv}</span>
                      <code className="stage-branch">{p.from}</code>
                    </div>

                    <ArrowRight size={14} className="stage-arrow text-muted" />

                    <div className="radar-stage">
                      <span className="stage-env">{p.toEnv}</span>
                      <code className="stage-branch">{p.to}</code>
                    </div>
                  </div>

                  <div className="radar-status-area">
                    {p.error ? (
                      <span className="radar-tag tag-error">{p.error}</span>
                    ) : p.missingBranch ? (
                      <span className="radar-tag tag-missing">Branch not created</span>
                    ) : hasPending ? (
                      <span className="radar-tag tag-drift">
                        <strong>{p.pending}</strong> commits pending
                      </span>
                    ) : (
                      <span className="radar-tag tag-synced">
                        <CheckCircle2 size={13} className="text-success" />
                        <span>In sync</span>
                      </span>
                    )}

                    <button
                      type="button"
                      className="radar-expand-btn"
                      aria-label={isOpen ? 'Collapse details' : 'Expand commits'}
                    >
                      {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </button>
                  </div>
                </div>

                {/* Expanded Commits Drawer */}
                {isOpen && (
                  <div className="radar-commits-drawer">
                    {detail?.loading ? (
                      <div className="commits-loading">
                        <Loader2 size={14} className="spin text-muted" />
                        <span>Fetching pending commit diffs...</span>
                      </div>
                    ) : detail?.error ? (
                      <div className="commits-error">{detail.error}</div>
                    ) : detail?.commits && detail.commits.length > 0 ? (
                      <div className="commits-list">
                        <div className="commits-header">
                          <span>
                            Showing {detail.commits.length} of {detail.total} pending commits
                          </span>
                          <button type="button" className="release-notes-btn" onClick={() => setNotesFor(p)}>
                            📝 Release notes
                          </button>
                          {detail.compareUrl && (
                            <a
                              href={detail.compareUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="compare-link"
                            >
                              <span>View GitHub diff</span>
                              <ExternalLink size={12} />
                            </a>
                          )}
                        </div>

                        {detail.commits.map((c) => (
                          <a
                            key={c.sha}
                            href={c.url}
                            target="_blank"
                            rel="noreferrer"
                            className="commit-row"
                          >
                            <GitCommit size={14} className="commit-icon flex-none text-muted" />
                            <code className="commit-sha">{c.sha.slice(0, 7)}</code>
                            <span className="commit-msg">{c.message}</span>
                            {c.author && <span className="commit-author">by {c.author}</span>}
                          </a>
                        ))}
                      </div>
                    ) : (
                      <div className="commits-empty">No unmerged commits found.</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        </>
      )}
      {notesFor && (
        <ReleaseNotes
          from={notesFor.from}
          base={notesFor.baseRef || notesFor.to}
          fromEnv={notesFor.fromEnv}
          toEnv={notesFor.toEnv}
          onClose={() => setNotesFor(null)}
        />
      )}
    </div>
  );
}
