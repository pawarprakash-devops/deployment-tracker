'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Search,
  Filter,
  CheckCircle2,
  Clock,
  AlertTriangle,
  RotateCcw,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  GitPullRequest,
  GitBranch,
  User,
  Calendar,
  Layers,
  X,
  Columns,
  Sparkles,
  Info,
} from 'lucide-react';
import { useShell } from './ctx';
import { StatusPill, Chip, ago, fmtDate, fmtDateTime, formatDuration } from './ui';

export interface DeploymentRow {
  id: string;
  environment: string;
  status: string;
  deployment_type?: string | null;
  branch?: string | null;
  version?: string | null;
  frontend_branch?: string | null;
  backend_branch?: string | null;
  frontend_version?: string | null;
  backend_version?: string | null;
  requested_by?: string | null;
  approved_by?: string | null;
  tested_by?: string | null;
  deployed_by?: string | null;
  ticket_link?: string | null;
  notes?: string | null;
  started_at: string;
  approved_at?: string | null;
  completed_at?: string | null;
  duration_seconds?: number | null;
}

interface PRInfo {
  type: 'FE' | 'BE' | 'PR';
  url: string;
  label: string;
}

function extractPRs(notes?: string | null, link?: string | null): PRInfo[] {
  const text = `${notes || ''} ${link || ''}`;
  if (!text.trim()) return [];
  const feNote = /frontend/i.test(text) && !/backend/i.test(text);
  const beNote = /backend/i.test(text) && !/frontend/i.test(text);
  const seen = new Set<string>();
  const out: PRInfo[] = [];

  for (const m of text.matchAll(/(?:(FE|BE)\s*#\s*|PR\s*#?\s*|#\s*)(\d{3,7})/gi)) {
    const prefix = m[1]?.toUpperCase() as 'FE' | 'BE' | undefined;
    const key = `${prefix || 'GEN'}-${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const type: PRInfo['type'] = prefix || (beNote ? 'BE' : feNote ? 'FE' : 'PR');
    const repo = type === 'BE' ? 'vidai-backend' : 'vidai-react';
    out.push({
      type,
      url: `https://github.com/vidaisolutions/${repo}/pull/${m[2]}`,
      label: prefix ? `${prefix}#${m[2]}` : `PR #${m[2]}`,
    });
  }
  return out;
}

function runIdFromLink(link?: string | null): string | null {
  if (!link) return null;
  const m = link.match(/actions\/runs\/(\d+)/);
  return m ? `#${m[1]}` : null;
}

const PAGE_SIZE = 25;
const ALL_STATUSES = [
  'All Statuses',
  'Success',
  'In Progress',
  'Queued',
  'Awaiting approval',
  'Failed',
  'Rolled Back',
  'Cancelled',
];

export default function ReleaseHistory() {
  const { refreshKey, envFilter, setEnvFilter, statusFilter, setStatusFilter } = useShell();

  const [rows, setRows] = useState<DeploymentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>(statusFilter || 'All Statuses');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | '7d' | '30d'>('all');

  // Compare selection (up to 2 IDs)
  const [compareIds, setCompareIds] = useState<string[]>([]);
  // Detail drawer
  const [detailRow, setDetailRow] = useState<DeploymentRow | null>(null);

  // Sync with context filters
  useEffect(() => {
    if (statusFilter) setSelectedStatus(statusFilter);
  }, [statusFilter]);

  const loadDeployments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/deployments?limit=1000', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : Array.isArray(data?.deployments) ? data.deployments : [];
      setRows(list);
      setTotal(list.length);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDeployments();
  }, [loadDeployments, refreshKey]);

  // Environments list for dropdown
  const envOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => set.add(r.environment));
    return ['All Environments', ...Array.from(set).sort()];
  }, [rows]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    let result = rows;

    // Environment filter
    if (envFilter && envFilter !== 'All Environments') {
      result = result.filter((r) => r.environment.toLowerCase() === envFilter.toLowerCase());
    }

    // Status filter
    if (selectedStatus && selectedStatus !== 'All Statuses') {
      const target = selectedStatus.toLowerCase();
      result = result.filter((r) => r.status.toLowerCase().includes(target));
    }

    // Date filter
    if (dateFilter !== 'all') {
      const now = Date.now();
      const cutoff =
        dateFilter === 'today'
          ? now - 86_400_000
          : dateFilter === '7d'
          ? now - 7 * 86_400_000
          : now - 30 * 86_400_000;

      result = result.filter((r) => new Date(r.started_at).getTime() >= cutoff);
    }

    // Search query (branch, version, notes, requested_by, deployed_by, ticket_link)
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      result = result.filter((r) => {
        return (
          r.environment.toLowerCase().includes(q) ||
          r.status.toLowerCase().includes(q) ||
          (r.branch && r.branch.toLowerCase().includes(q)) ||
          (r.version && r.version.toLowerCase().includes(q)) ||
          (r.frontend_branch && r.frontend_branch.toLowerCase().includes(q)) ||
          (r.backend_branch && r.backend_branch.toLowerCase().includes(q)) ||
          (r.requested_by && r.requested_by.toLowerCase().includes(q)) ||
          (r.deployed_by && r.deployed_by.toLowerCase().includes(q)) ||
          (r.notes && r.notes.toLowerCase().includes(q)) ||
          (r.ticket_link && r.ticket_link.toLowerCase().includes(q))
        );
      });
    }

    return result;
  }, [rows, envFilter, selectedStatus, dateFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredRows.slice(start, start + PAGE_SIZE);
  }, [filteredRows, currentPage]);

  // Handle compare toggle
  const toggleCompare = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCompareIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((i) => i !== id);
      }
      if (prev.length >= 2) {
        return [prev[1], id];
      }
      return [...prev, id];
    });
  };

  const triggerCompare = () => {
    if (compareIds.length === 2) {
      const left = rows.find((r) => r.id === compareIds[0]);
      const right = rows.find((r) => r.id === compareIds[1]);
      if (left && right) {
        window.dispatchEvent(new CustomEvent('tracker:compare', { detail: { left, right } }));
      }
    }
  };

  return (
    <div className="history-section">
      <div className="section-header">
        <div>
          <h2 className="section-title">Deployment History</h2>
          <p className="section-subtitle">
            Auditable log of all deployments, approvals, workflow links and execution durations
          </p>
        </div>

        {compareIds.length === 2 && (
          <button type="button" className="btn btn-accent btn-sm" onClick={triggerCompare}>
            <Columns size={14} />
            <span>Compare 2 Selected Runs</span>
          </button>
        )}
      </div>

      {/* Modern Filter Toolbar */}
      <div className="history-filter-bar">
        {/* Search Input */}
        <div className="filter-search-box">
          <Search size={15} className="filter-search-icon" />
          <input
            type="text"
            className="filter-search-input"
            placeholder="Filter branch, version, PR, deployer, notes..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          {search && (
            <button
              type="button"
              className="filter-clear-btn"
              onClick={() => setSearch('')}
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Environment Filter */}
        <div className="filter-dropdown-wrap">
          <select
            className="filter-select"
            value={envFilter || 'All Environments'}
            onChange={(e) => {
              setEnvFilter(e.target.value === 'All Environments' ? null : e.target.value);
              setPage(1);
            }}
          >
            {envOptions.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </div>

        {/* Status Filter */}
        <div className="filter-dropdown-wrap">
          <select
            className="filter-select"
            value={selectedStatus}
            onChange={(e) => {
              setSelectedStatus(e.target.value);
              if (statusFilter && e.target.value === 'All Statuses') setStatusFilter(null);
              setPage(1);
            }}
          >
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* Date Presets */}
        <div className="filter-date-group">
          {(['all', 'today', '7d', '30d'] as const).map((d) => (
            <button
              key={d}
              type="button"
              className={`filter-date-btn ${dateFilter === d ? 'is-active' : ''}`}
              onClick={() => {
                setDateFilter(d);
                setPage(1);
              }}
            >
              {d === 'all' ? 'All time' : d === 'today' ? 'Today' : d}
            </button>
          ))}
        </div>
      </div>

      {/* Table Container */}
      <div className="table-card">
        <div className="table-responsive">
          <table className="history-table">
            <thead>
              <tr>
                <th style={{ width: 44 }}>
                  <span className="sr-only">Compare</span>
                </th>
                <th>Status</th>
                <th>Environment</th>
                <th>Runtime Versions / Branches</th>
                <th>Deployed By</th>
                <th>Workflow Run / PRs</th>
                <th>Duration</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="table-loading-cell">
                    <span>Loading deployment history...</span>
                  </td>
                </tr>
              ) : paginatedRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="table-empty-cell">
                    <span>No deployments match the selected filters.</span>
                  </td>
                </tr>
              ) : (
                paginatedRows.map((row) => {
                  const prs = extractPRs(row.notes, row.ticket_link);
                  const runId = runIdFromLink(row.ticket_link);
                  const isChecked = compareIds.includes(row.id);

                  return (
                    <tr
                      key={row.id}
                      className={`history-row ${isChecked ? 'is-selected' : ''}`}
                      onClick={() => setDetailRow(row)}
                    >
                      {/* Checkbox for compare */}
                      <td className="cell-checkbox" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="table-checkbox"
                          checked={isChecked}
                          onChange={(e) => toggleCompare(row.id, e as unknown as React.MouseEvent)}
                          title="Select to compare"
                        />
                      </td>

                      {/* Status */}
                      <td className="cell-status">
                        <StatusPill status={row.status} />
                      </td>

                      {/* Environment */}
                      <td className="cell-env">
                        <span className="env-cell-text">{row.environment}</span>
                      </td>

                      {/* Runtime Versions (FE/BE) */}
                      <td className="cell-versions">
                        <div className="versions-cell-wrap">
                          {row.frontend_branch || row.frontend_version ? (
                            <span className="version-chip-tag is-fe" title="Frontend">
                              FE: {row.frontend_branch || '—'}{' '}
                              {row.frontend_version ? `(${row.frontend_version})` : ''}
                            </span>
                          ) : null}
                          {row.backend_branch || row.backend_version ? (
                            <span className="version-chip-tag is-be" title="Backend">
                              BE: {row.backend_branch || '—'}{' '}
                              {row.backend_version ? `(${row.backend_version})` : ''}
                            </span>
                          ) : null}
                          {!row.frontend_branch &&
                            !row.backend_branch &&
                            !row.frontend_version &&
                            !row.backend_version && (
                              <span className="version-chip-tag is-single">
                                {row.branch || row.version || '—'}
                              </span>
                            )}
                        </div>
                      </td>

                      {/* Deployed / Requested By */}
                      <td className="cell-author">
                        <div className="author-cell">
                          <User size={13} className="text-muted" />
                          <span>{row.requested_by || row.deployed_by || 'GitHub Actions'}</span>
                        </div>
                      </td>

                      {/* Run / PRs */}
                      <td className="cell-links" onClick={(e) => e.stopPropagation()}>
                        <div className="links-cell-wrap">
                          {row.ticket_link && (
                            <a
                              href={row.ticket_link}
                              target="_blank"
                              rel="noreferrer"
                              className="action-run-link"
                              title="Open GitHub Actions run"
                            >
                              <span>{runId || 'Actions Run'}</span>
                              <ExternalLink size={11} />
                            </a>
                          )}
                          {prs.map((pr) => (
                            <a
                              key={pr.url}
                              href={pr.url}
                              target="_blank"
                              rel="noreferrer"
                              className="pr-chip-link"
                              title={`GitHub PR: ${pr.label}`}
                            >
                              <GitPullRequest size={11} />
                              <span>{pr.label}</span>
                            </a>
                          ))}
                        </div>
                      </td>

                      {/* Duration */}
                      <td className="cell-duration tnum">
                        {formatDuration(row.duration_seconds)}
                      </td>

                      {/* When */}
                      <td className="cell-when" title={fmtDateTime(row.started_at)}>
                        <div className="when-cell">
                          <span className="when-relative">{ago(row.started_at)}</span>
                          <span className="when-date tnum">{fmtDate(row.started_at)}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="table-pagination">
          <span className="pagination-count">
            Showing{' '}
            <strong>
              {filteredRows.length > 0 ? (currentPage - 1) * PAGE_SIZE + 1 : 0}–
              {Math.min(currentPage * PAGE_SIZE, filteredRows.length)}
            </strong>{' '}
            of <strong>{filteredRows.length}</strong> deployments
          </span>

          <div className="pagination-controls">
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              disabled={currentPage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft size={14} />
              <span>Previous</span>
            </button>
            <span className="page-indicator tnum">
              Page {currentPage} of {totalPages}
            </span>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              disabled={currentPage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              <span>Next</span>
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Deployment Detail Slide-Over Drawer */}
      {detailRow && (
        <div className="drawer-overlay" onClick={() => setDetailRow(null)}>
          <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <span className="drawer-eyebrow">{detailRow.environment}</span>
                <h3 className="drawer-title">Deployment Details</h3>
              </div>
              <button
                type="button"
                className="drawer-close-btn"
                onClick={() => setDetailRow(null)}
                aria-label="Close drawer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="drawer-body">
              {/* Status Header */}
              <div className="drawer-status-card">
                <StatusPill status={detailRow.status} />
                <span className="drawer-duration tnum">
                  Duration: {formatDuration(detailRow.duration_seconds)}
                </span>
              </div>

              {/* Meta Grid */}
              <div className="drawer-meta-grid">
                <div className="drawer-meta-item">
                  <span className="meta-label">Environment</span>
                  <span className="meta-value">{detailRow.environment}</span>
                </div>
                <div className="drawer-meta-item">
                  <span className="meta-label">Deployment Type</span>
                  <span className="meta-value">{detailRow.deployment_type || 'standard'}</span>
                </div>
                <div className="drawer-meta-item">
                  <span className="meta-label">Started At</span>
                  <span className="meta-value tnum">{fmtDateTime(detailRow.started_at)}</span>
                </div>
                <div className="drawer-meta-item">
                  <span className="meta-label">Completed At</span>
                  <span className="meta-value tnum">{fmtDateTime(detailRow.completed_at)}</span>
                </div>
                <div className="drawer-meta-item">
                  <span className="meta-label">Requested By</span>
                  <span className="meta-value">{detailRow.requested_by || '—'}</span>
                </div>
                <div className="drawer-meta-item">
                  <span className="meta-label">Deployed By</span>
                  <span className="meta-value">{detailRow.deployed_by || '—'}</span>
                </div>
              </div>

              {/* Version Information */}
              <div className="drawer-section">
                <h4 className="drawer-section-title">Versions &amp; Branches</h4>
                <div className="drawer-version-cards">
                  <div className="version-subcard">
                    <span className="subcard-tag is-fe">Frontend</span>
                    <div className="subcard-content">
                      <div>
                        <strong>Branch:</strong> <code>{detailRow.frontend_branch || '—'}</code>
                      </div>
                      <div>
                        <strong>Version:</strong> <code>{detailRow.frontend_version || '—'}</code>
                      </div>
                    </div>
                  </div>
                  <div className="version-subcard">
                    <span className="subcard-tag is-be">Backend</span>
                    <div className="subcard-content">
                      <div>
                        <strong>Branch:</strong> <code>{detailRow.backend_branch || '—'}</code>
                      </div>
                      <div>
                        <strong>Version:</strong> <code>{detailRow.backend_version || '—'}</code>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Workflow Link & PRs */}
              {detailRow.ticket_link && (
                <div className="drawer-section">
                  <h4 className="drawer-section-title">Workflow Run</h4>
                  <a
                    href={detailRow.ticket_link}
                    target="_blank"
                    rel="noreferrer"
                    className="drawer-link-btn"
                  >
                    <span>{detailRow.ticket_link}</span>
                    <ExternalLink size={14} />
                  </a>
                </div>
              )}

              {/* Notes */}
              {detailRow.notes && (
                <div className="drawer-section">
                  <h4 className="drawer-section-title">Execution Notes</h4>
                  <pre className="drawer-notes-pre">{detailRow.notes}</pre>
                </div>
              )}
            </div>

            <div className="drawer-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDetailRow(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
