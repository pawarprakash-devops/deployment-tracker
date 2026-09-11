'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface Deployment {
  id: string;
  environment: string;
  status: string;
  branch?: string;
  version?: string;
  frontend_branch?: string;
  backend_branch?: string;
  frontend_version?: string;
  backend_version?: string;
  requested_by?: string;
  approved_by?: string;
  tested_by?: string;
  deployed_by?: string;
  ticket_link?: string;
  notes?: string;
  started_at: string;
  completed_at?: string;
  duration_seconds?: number;
  duration?: string;
}

interface Environment {
  name: string;
  color: string;
  isProd: boolean;
  displayOrder?: number;
  description?: string;
}

interface ClusterHealthResult {
  environment: string;
  targetName: string;
  url: string;
  status: 'HEALTHY' | 'DEGRADED' | 'OFFLINE';
  statusCode: number | null;
  latencyMs: number;
  message: string;
  checkedAt: string;
}

const PROMOTION_ORDER: Record<string, number> = {
  'Preview': 1,
  'QA': 2,
  'Stage': 3,
  'Stage EUW2': 3,
  'Pre-Prod': 4,
  'Pre-Prod (India)': 4,
  'Pre-Prod USW': 5,
  'Production (Ankura)': 6,
  'Production (Neotia)': 7,
  'Production (Neotia/Babyjoy)': 7,
  'Production': 8,
  'LMS': 9,
  'Other': 10,
};

const STANDARD_BRANCHES = [
  { branch: 'dev', env: 'Preview', label: 'dev (Preview)' },
  { branch: 'qa', env: 'QA', label: 'qa (QA)' },
  { branch: 'stage', env: 'Stage', label: 'stage (Stage)' },
  { branch: 'preprod', env: 'Pre-Prod', label: 'preprod (Pre-Prod India)' },
  { branch: 'preprod_usw', env: 'Pre-Prod USW', label: 'preprod_usw (Pre-Prod USW)' },
  { branch: 'prod_ank', env: 'Production (Ankura)', label: 'prod_ank (Prod Ankura)' },
  { branch: 'prod_neo', env: 'Production (Neotia/Babyjoy)', label: 'prod_neo (Prod Neotia)' },
];

const ENV_DEFAULT_BRANCH: Record<string, string> = {
  'Preview': 'dev',
  'QA': 'qa',
  'Stage': 'stage',
  'Stage EUW2': 'stage',
  'Pre-Prod': 'preprod',
  'Pre-Prod (India)': 'preprod',
  'Pre-Prod USW': 'preprod_usw',
  'Production (Ankura)': 'prod_ank',
  'Production (Neotia)': 'prod_neo',
  'Production (Neotia/Babyjoy)': 'prod_neo',
  'Production': 'prod_ank',
};

export type ThemeMode = 'vidai' | 'dark' | 'midnight' | 'light';

const ENV_CLUSTER_MAP: Record<string, { region: string; clusterShort: string; type: string }> = {
  'Preview': { region: 'ap-south-1', clusterShort: 'preview-99999', type: 'Fargate' },
  'QA': { region: 'ap-south-1', clusterShort: 'qa-aps-ecs', type: 'ECS' },
  'Stage': { region: 'ap-south-1', clusterShort: 'stage-aps-ecs', type: 'ECS' },
  'Stage EUW2': { region: 'eu-west-2', clusterShort: 'staging-euw2', type: 'ECS' },
  'Stage USE1': { region: 'us-east-1', clusterShort: 'staging-use1', type: 'ECS' },
  'Pre-Prod': { region: 'ap-south-1', clusterShort: 'pre-prod-ecs', type: 'ECS' },
  'Pre-Prod (India)': { region: 'ap-south-1', clusterShort: 'pre-prod-ecs', type: 'ECS' },
  'Pre-Prod USW': { region: 'us-west-2', clusterShort: 'pre-prod-usw', type: 'ECS' },
  'Production (Ankura)': { region: 'ap-south-1', clusterShort: 'vidai-prod', type: 'PROD' },
  'Production (Neotia)': { region: 'ap-south-1', clusterShort: 'prod-aps', type: 'PROD' },
  'Production (Neotia/Babyjoy)': { region: 'ap-south-1', clusterShort: 'prod-aps', type: 'PROD' },
  'Production': { region: 'ap-south-1', clusterShort: 'vidai-prod', type: 'PROD' },
  'LMS': { region: 'ap-south-1', clusterShort: 'lms-aps-ecs', type: 'ECS' },
};

function getClusterInfo(envName: string): { region: string; clusterShort: string; type: string } {
  if (ENV_CLUSTER_MAP[envName]) return ENV_CLUSTER_MAP[envName];
  const lower = envName.toLowerCase();
  let region = 'ap-south-1';
  if (/euw2|eu-west-2|london/.test(lower)) region = 'eu-west-2';
  else if (/usw2|us-west-2|oregon/.test(lower)) region = 'us-west-2';
  else if (/use1|us-east-1|virginia/.test(lower)) region = 'us-east-1';
  else if (/euc1|eu-central-1|frankfurt/.test(lower)) region = 'eu-central-1';

  const type = /prod/i.test(lower) && !/pre-prod|preprod/i.test(lower) ? 'PROD' : 'ECS';
  const clusterShort = envName.toLowerCase().replace(/\s+/g, '-');
  return { region, clusterShort, type };
}

const KNOWN_USERS: Record<string, { github: string; name: string; initials: string }> = {
  'pawarprakash-devops': { github: 'pawarprakash-devops', name: 'Prakash Pawar', initials: 'PP' },
  'Prakash Pawar': { github: 'pawarprakash-devops', name: 'Prakash Pawar', initials: 'PP' },
  'Sonali Mathur': { github: 'sonalimathur', name: 'Sonali Mathur', initials: 'SM' },
  'sonalimathur': { github: 'sonalimathur', name: 'Sonali Mathur', initials: 'SM' },
  'kuldeeplodha': { github: 'kuldeeplodha', name: 'Kuldeep Lodha', initials: 'KL' },
  'saranya13-tech': { github: 'saranya13-tech', name: 'Saranya Tech', initials: 'ST' },
  'dev-prafulk': { github: 'dev-prafulk', name: 'Praful K', initials: 'PK' },
  'GitHub Actions': { github: 'github-actions[bot]', name: 'GitHub Actions', initials: 'GA' },
  'system': { github: '', name: 'System', initials: 'SY' }
};

function getAuthorAvatar(userStr?: string | null) {
  if (!userStr || userStr === '—') return null;
  const clean = userStr.trim().replace(/^@/, '');
  const meta = KNOWN_USERS[clean] || KNOWN_USERS[userStr];
  const ghHandle = meta ? meta.github : (/^[a-zA-Z0-9-_]+$/.test(clean) ? clean : null);
  const displayName = meta ? meta.name : clean;
  const initials = meta
    ? meta.initials
    : clean.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || clean.slice(0, 2).toUpperCase();

  const avatarUrl = ghHandle && !ghHandle.includes('[bot]') ? `https://github.com/${ghHandle}.png?size=48` : null;

  return {
    handle: clean,
    displayName,
    initials,
    avatarUrl
  };
}

function UserAvatarBadge({ user, size = 18 }: { user?: string | null; size?: number }) {
  const [imgError, setImgError] = useState(false);
  const meta = getAuthorAvatar(user);
  if (!meta) return <span style={{ color: 'var(--faint)' }}>—</span>;

  return (
    <span className="user-avatar-badge" title={`@${meta.handle} (${meta.displayName})`}>
      {meta.avatarUrl && !imgError ? (
        <img
          src={meta.avatarUrl}
          alt={meta.handle}
          className="user-avatar-img"
          style={{ width: size, height: size }}
          onError={() => setImgError(true)}
        />
      ) : (
        <span
          className="user-avatar-initials"
          style={{ width: size, height: size, fontSize: Math.max(8.5, Math.floor(size * 0.45)) }}
        >
          {meta.initials}
        </span>
      )}
      <span className="user-avatar-text">{meta.displayName}</span>
    </span>
  );
}

function getQANextWindow(): {
  countdownText: string;
  badge: string;
  isImminent: boolean;
  isOpen: boolean;
  windowLabel: string;
  windowIndex: number;
} {
  const now = new Date();
  const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
  const istTime = new Date(utcMs + (5.5 * 3600000));

  const istHours = istTime.getHours();
  const istMinutes = istTime.getMinutes();
  const istSeconds = istTime.getSeconds();
  const currentTotalSeconds = istHours * 3600 + istMinutes * 60 + istSeconds;

  const W1 = 13 * 3600 + 30 * 60; // 13:30:00 IST (1:30 PM)
  const W2 = 17 * 3600 + 30 * 60; // 17:30:00 IST (5:30 PM)
  const WINDOW_DURATION = 15 * 60; // 15 mins

  if (currentTotalSeconds >= W1 && currentTotalSeconds < W1 + WINDOW_DURATION) {
    const rem = (W1 + WINDOW_DURATION) - currentTotalSeconds;
    return {
      countdownText: `${Math.floor(rem / 60)}m ${rem % 60}s LEFT`,
      badge: 'WINDOW 1 ACTIVE',
      isImminent: false,
      isOpen: true,
      windowLabel: '01:30 PM IST',
      windowIndex: 0
    };
  }

  if (currentTotalSeconds >= W2 && currentTotalSeconds < W2 + WINDOW_DURATION) {
    const rem = (W2 + WINDOW_DURATION) - currentTotalSeconds;
    return {
      countdownText: `${Math.floor(rem / 60)}m ${rem % 60}s LEFT`,
      badge: 'WINDOW 2 ACTIVE',
      isImminent: false,
      isOpen: true,
      windowLabel: '05:30 PM IST',
      windowIndex: 1
    };
  }

  let targetSeconds: number;
  let windowIndex: number;
  let windowLabel: string;

  if (currentTotalSeconds < W1) {
    targetSeconds = W1;
    windowIndex = 0;
    windowLabel: '01:30 PM IST';
    windowLabel = '01:30 PM IST';
  } else if (currentTotalSeconds < W2) {
    targetSeconds = W2;
    windowIndex = 1;
    windowLabel = '05:30 PM IST';
  } else {
    targetSeconds = 24 * 3600 + W1;
    windowIndex = 0;
    windowLabel = 'Tomorrow 01:30 PM IST';
  }

  const diffSec = targetSeconds - currentTotalSeconds;
  const hours = Math.floor(diffSec / 3600);
  const mins = Math.floor((diffSec % 3600) / 60);
  const secs = diffSec % 60;

  const isImminent = diffSec <= 1800; // within 30m
  const countdownText = hours > 0 ? `${hours}h ${mins}m ${secs}s` : `${mins}m ${secs}s`;
  const badge = isImminent ? 'CLOSING IN' : windowLabel;

  return {
    countdownText,
    badge,
    isImminent,
    isOpen: false,
    windowLabel,
    windowIndex
  };
}

function renderNoteWithLinks(note: string) {
  if (!note) return null;
  const parts = note.split(/(PR\s*#?\d+|#\d{3,7})/i);
  return parts.map((part, i) => {
    const prMatch = part.match(/(?:PR\s*#?|#)(\d+)/i);
    if (prMatch) {
      const prNum = prMatch[1];
      const isFE = /frontend/i.test(note);
      const repo = isFE ? 'vidaisolutions/vidai-react' : 'vidaisolutions/vidai-backend';
      return (
        <a
          key={i}
          href={`https://github.com/${repo}/pull/${prNum}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-pr-link"
          title={`View Pull Request #${prNum} on GitHub`}
        >
          {part}
        </a>
      );
    }
    return part;
  });
}

export default function Home() {
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginPassword, setLoginPassword] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>('vidai');
  const [clusterHealth, setClusterHealth] = useState<Record<string, ClusterHealthResult>>({});
  const [isProbing, setIsProbing] = useState(false);
  const [lastProbed, setLastProbed] = useState<Date | null>(null);
  
  // QA Scheduled Release Cadence (1:30 PM & 5:30 PM IST)
  const [qaNextWindow, setQaNextWindow] = useState(getQANextWindow());

  useEffect(() => {
    const timer = setInterval(() => {
      setQaNextWindow(getQANextWindow());
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  
  // Comparison
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [compareData, setCompareData] = useState<any>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareRepo, setCompareRepo] = useState<string>('vidaisolutions/vidai-react');
  
  // Modal states
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [showEnvModal, setShowEnvModal] = useState(false);
  const [editingDeployId, setEditingDeployId] = useState<string | null>(null);
  
  // Filter states
  const [filterEnv, setFilterEnv] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Form states
  const [deployForm, setDeployForm] = useState({
    environment: '',
    status: 'Success',
    branch: '',
    version: '',
    datetime: '',
    duration: '',
    requested_by: '',
    approved_by: '',
    tested_by: '',
    deployed_by: '',
    ticket_link: '',
    notes: ''
  });

  const [newEnvForm, setNewEnvForm] = useState({
    name: '',
    color: '#5B8DEF',
    isProd: false,
    description: ''
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load theme from localStorage
  useEffect(() => {
    const savedTheme = localStorage.getItem('tracker-theme') as ThemeMode | null;
    if (savedTheme && ['vidai', 'dark', 'midnight', 'light'].includes(savedTheme)) {
      setTheme(savedTheme);
    }
  }, []);

  const handleThemeChange = (newTheme: ThemeMode) => {
    setTheme(newTheme);
    localStorage.setItem('tracker-theme', newTheme);
  };

  const checkAuth = async () => {
    try {
      const res = await fetch('/api/auth/session');
      const data = await res.json();
      setIsAdmin(data.authenticated);
    } catch (error) {
      setIsAdmin(false);
    }
  };

  const handleLogin = async () => {
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: loginPassword })
      });
      if (res.ok) {
        setIsAdmin(true);
        setShowLoginModal(false);
        setLoginPassword('');
      } else {
        alert('Invalid password');
      }
    } catch (error) {
      alert('Login failed');
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth', { method: 'DELETE' });
      setIsAdmin(false);
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const probeClusterHealth = useCallback(async () => {
    setIsProbing(true);
    try {
      const res = await fetch('/api/cluster-health');
      if (res.ok) {
        const data = await res.json();
        if (data.by_environment) {
          setClusterHealth(data.by_environment);
          setLastProbed(new Date());
        }
      }
    } catch (error) {
      console.error('Error probing cluster health:', error);
    } finally {
      setIsProbing(false);
    }
  }, []);

  const loadData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [deploymentsRes, environmentsRes] = await Promise.all([
        fetch('/api/deployments?limit=1000'),
        fetch('/api/environments'),
      ]);
      if (deploymentsRes.ok) {
        const data = await deploymentsRes.json();
        const rawList = Array.isArray(data) ? data : [];
        const normalized = rawList.map((d: any) => {
          let env = d.environment;
          if (env === 'Other' && d.notes) {
            if (/stage-euw2|staging-euw2|euw2/i.test(d.notes)) env = 'Stage EUW2';
            else if (/qa-aps|qa/i.test(d.notes) && !/prod/i.test(d.notes)) env = 'QA';
            else if (/stage/i.test(d.notes)) env = 'Stage';
          }
          return { ...d, environment: env };
        });
        setDeployments(normalized);
      }
      if (environmentsRes.ok) {
        const envData = await environmentsRes.json();
        if (Array.isArray(envData)) {
          const envList = envData.map(e => {
            const isProd = e.is_production || e.name.toLowerCase().startsWith('production');
            return {
              name: e.name,
              color: isProd ? '#EF4444' : '#5B8DEF',
              isProd,
              displayOrder: e.display_order ?? PROMOTION_ORDER[e.name] ?? 99,
              description: ''
            };
          });
          if (!envList.some(e => e.name === 'Stage EUW2')) {
            envList.push({
              name: 'Stage EUW2',
              color: '#5B8DEF',
              isProd: false,
              displayOrder: 3.1,
              description: 'Stage London (eu-west-2)'
            });
          }
          setEnvironments(envList);
        }
      }
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
      setTimeout(() => setIsRefreshing(false), 300);
    }
  }, []);

  useEffect(() => {
    loadData();
    probeClusterHealth();
    checkAuth();
    const interval = setInterval(() => {
      loadData();
      probeClusterHealth();
    }, 60000);
    return () => clearInterval(interval);
  }, [loadData, probeClusterHealth]);

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'Success': return 'success';
      case 'In Progress': return 'progress';
      case 'Failed': return 'failed';
      case 'Rolled Back': return 'rollback';
      case 'Cancelled': return 'cancelled';
      default: return 'none';
    }
  };

  const timeAgo = (isoDate: string) => {
    const diff = (Date.now() - new Date(isoDate).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  };

  const latestForEnv = (envName: string) => {
    return deployments
      .filter(d => d.environment === envName)
      .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())[0];
  };

  const latestBranchesForEnv = (envName: string) => {
    const envDeployments = deployments
      .filter(d => d.environment === envName && d.status === 'Success')
      .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
    let latestFE: string | null = null;
    let latestBE: string | null = null;
    for (const d of envDeployments) {
      if (!latestFE && d.frontend_branch) latestFE = d.frontend_branch;
      if (!latestBE && d.backend_branch) latestBE = d.backend_branch;
      if (latestFE && latestBE) break;
    }
    return { fe: latestFE, be: latestBE };
  };

  // Environment health status
  const getEnvHealth = (envName: string) => {
    const envDeps = deployments
      .filter(d => d.environment === envName)
      .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
    
    if (envDeps.length === 0) return { status: 'empty', label: 'No deploys', color: 'var(--faint)' };
    
    const latest = envDeps[0];
    const daysSinceDeploy = (Date.now() - new Date(latest.started_at).getTime()) / (1000 * 60 * 60 * 24);
    
    // Check consecutive failures
    let consecutiveFailures = 0;
    for (const d of envDeps) {
      if (d.status === 'Failed') consecutiveFailures++;
      else break;
    }
    
    if (consecutiveFailures >= 3) return { status: 'critical', label: `${consecutiveFailures} consecutive failures`, color: 'var(--bad)' };
    if (consecutiveFailures >= 2) return { status: 'warning', label: `${consecutiveFailures} consecutive failures`, color: 'var(--warn)' };
    if (daysSinceDeploy > 30) return { status: 'stale', label: `Stale (${Math.floor(daysSinceDeploy)}d ago)`, color: 'var(--warn)' };
    if (daysSinceDeploy > 14) return { status: 'aging', label: `Aging (${Math.floor(daysSinceDeploy)}d ago)`, color: 'var(--faint)' };
    
    return { status: 'healthy', label: '', color: 'var(--ok)' };
  };

  // Last deploy times for FE and BE
  const getLastDeployTimes = (envName: string) => {
    const envDeps = deployments
      .filter(d => d.environment === envName && d.status === 'Success')
      .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
    
    let lastFE: string | null = null;
    let lastBE: string | null = null;
    
    for (const d of envDeps) {
      if (!lastFE && d.frontend_branch) lastFE = d.started_at;
      if (!lastBE && d.backend_branch) lastBE = d.started_at;
      if (lastFE && lastBE) break;
    }
    
    return { feAgo: lastFE ? timeAgo(lastFE) : null, beAgo: lastBE ? timeAgo(lastBE) : null };
  };

  // Timeline data for last 14 days
  const getTimelineData = () => {
    const days: { date: string; label: string; envData: Record<string, { success: number; failed: number; other: number }> }[] = [];
    
    for (let i = 13; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const label = date.toLocaleDateString('en', { month: 'short', day: 'numeric' });
      
      const envData: Record<string, { success: number; failed: number; other: number }> = {};
      environments.forEach(env => {
        const dayDeps = deployments.filter(d => 
          d.environment === env.name && d.started_at.startsWith(dateStr)
        );
        envData[env.name] = {
          success: dayDeps.filter(d => d.status === 'Success').length,
          failed: dayDeps.filter(d => d.status === 'Failed').length,
          other: dayDeps.filter(d => d.status !== 'Success' && d.status !== 'Failed').length,
        };
      });
      
      days.push({ date: dateStr, label, envData });
    }
    
    return days;
  };

  // Ticket & PR link formatter
  const formatTicketLink = (link?: string | null, notes?: string | null) => {
    if (!link && !notes) return null;
    
    let text = '';
    let fullText = '';
    let url = link || '';

    if (link) {
      const ghMatch = link.match(/github\.com\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)/);
      if (ghMatch) {
        text = `#${ghMatch[3].slice(-6)}`;
        fullText = `${ghMatch[1]}/${ghMatch[2]} Run #${ghMatch[3]}`;
      } else {
        const ghPrMatch = link.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
        if (ghPrMatch) {
          text = `PR #${ghPrMatch[3]}`;
          fullText = `${ghPrMatch[1]}/${ghPrMatch[2]} PR #${ghPrMatch[3]}`;
        } else {
          const jiraMatch = link.match(/((?:[A-Z]+-\d+))/);
          if (jiraMatch) {
            text = jiraMatch[1];
            fullText = jiraMatch[1];
          } else {
            try {
              const u = new URL(link);
              text = u.pathname.split('/').pop() || u.hostname;
              fullText = u.hostname + u.pathname;
            } catch {
              text = link.length > 25 ? link.slice(0, 25) + '...' : link;
              fullText = link;
            }
          }
        }
      }
    }

    let prUrl: string | null = null;
    let prText: string | null = null;
    if (notes) {
      const prMatch = notes.match(/(?:PR\s*#?|#)(\d{3,7})/i);
      if (prMatch) {
        const prNum = prMatch[1];
        const isFE = /frontend/i.test(notes);
        const repo = isFE ? 'vidaisolutions/vidai-react' : 'vidaisolutions/vidai-backend';
        prUrl = `https://github.com/${repo}/pull/${prNum}`;
        prText = `PR #${prNum}`;
      }
    }

    return {
      text,
      fullText,
      url,
      prUrl,
      prText
    };
  };

  // Compare deployments
  const toggleCompare = (id: string) => {
    setCompareIds(prev => {
      if (prev.includes(id)) return prev.filter(i => i !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  const openCompare = async (targetRepo?: string) => {
    setShowCompareModal(true);
    setCompareLoading(true);
    setCompareData(null);

    const d1 = deployments.find(d => d.id === compareIds[0]);
    const d2 = deployments.find(d => d.id === compareIds[1]);
    if (!d1 || !d2) { setCompareLoading(false); return; }

    // Determine older and newer deployment
    const [older, newer] = new Date(d1.started_at) < new Date(d2.started_at) ? [d1, d2] : [d2, d1];

    // Determine repo - FE or BE
    const isFE = !!(newer.frontend_branch || (!newer.backend_branch && newer.notes?.includes('frontend')));
    const repo = targetRepo || (isFE ? 'vidaisolutions/vidai-react' : 'vidaisolutions/vidai-backend');
    setCompareRepo(repo);

    const isTargetFE = repo.includes('vidai-react');
    let olderBranch = isTargetFE
      ? (older.frontend_branch || older.branch || ENV_DEFAULT_BRANCH[older.environment])
      : (older.backend_branch || older.branch || ENV_DEFAULT_BRANCH[older.environment]);
    let newerBranch = isTargetFE
      ? (newer.frontend_branch || newer.branch || ENV_DEFAULT_BRANCH[newer.environment])
      : (newer.backend_branch || newer.branch || ENV_DEFAULT_BRANCH[newer.environment]);

    try {
      // Try comparing branches
      if (olderBranch && newerBranch && olderBranch !== newerBranch) {
        const res = await fetch(`/api/compare?repo=${encodeURIComponent(repo)}&base=${encodeURIComponent(olderBranch)}&head=${encodeURIComponent(newerBranch)}`);
        if (res.ok) {
          const data = await res.json();
          if (!data.error) {
            setCompareData({ ...data, repo, older, newer, baseBranch: olderBranch, headBranch: newerBranch });
            setCompareLoading(false);
            return;
          }
        }
      }
      
      // Fallback: get recent commits on the newer branch
      if (newerBranch) {
        const res = await fetch(`/api/compare?repo=${encodeURIComponent(repo)}&head=${encodeURIComponent(newerBranch)}`);
        if (res.ok) {
          const data = await res.json();
          setCompareData({ ...data, repo, older, newer, headBranch: newerBranch, fallback: true });
        }
      }
    } catch (error) {
      console.error('Compare fetch failed:', error);
    } finally {
      setCompareLoading(false);
    }
  };

  const openNewDeploy = () => {
    setEditingDeployId(null);
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    const defaultEnv = environments[0]?.name || 'Preview';
    setDeployForm({
      environment: defaultEnv,
      status: 'Success',
      branch: ENV_DEFAULT_BRANCH[defaultEnv] || 'dev',
      version: '',
      datetime: now.toISOString().slice(0, 16),
      duration: '',
      requested_by: '',
      approved_by: '',
      tested_by: '',
      deployed_by: '',
      ticket_link: '',
      notes: ''
    });
    setShowDeployModal(true);
  };

  const openEditDeploy = (deployment: Deployment) => {
    setEditingDeployId(deployment.id);
    setDeployForm({
      environment: deployment.environment,
      status: deployment.status,
      branch: deployment.branch || '',
      version: deployment.version || '',
      datetime: deployment.started_at?.slice(0, 16) || '',
      duration: deployment.duration || '',
      requested_by: deployment.requested_by || '',
      approved_by: deployment.approved_by || '',
      tested_by: deployment.tested_by || '',
      deployed_by: deployment.deployed_by || '',
      ticket_link: deployment.ticket_link || '',
      notes: deployment.notes || ''
    });
    setShowDeployModal(true);
  };

  const saveDeploy = async () => {
    if (!deployForm.environment || !deployForm.branch || !deployForm.requested_by || !deployForm.datetime) {
      alert('Please fill in Environment, Branch, Date & Time, and Requested By.');
      return;
    }
    const payload: any = {
      environment: deployForm.environment,
      status: deployForm.status,
      branch: deployForm.branch,
      version: deployForm.version,
      requested_by: deployForm.requested_by,
      approved_by: deployForm.approved_by,
      tested_by: deployForm.tested_by,
      deployed_by: deployForm.deployed_by,
      ticket_link: deployForm.ticket_link,
      notes: deployForm.notes,
      started_at: new Date(deployForm.datetime).toISOString(),
    };
    if (deployForm.duration) payload.duration = deployForm.duration;
    try {
      if (editingDeployId) {
        await fetch(`/api/deployments/${editingDeployId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } else {
        await fetch('/api/deployments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }
      setShowDeployModal(false);
      loadData();
    } catch (error) {
      alert('Failed to save deployment');
    }
  };

  const deleteDeploy = async (id: string) => {
    if (!confirm('Delete this deployment entry?')) return;
    try {
      await fetch(`/api/deployments/${id}`, { method: 'DELETE' });
      loadData();
    } catch (error) {
      alert('Failed to delete deployment');
    }
  };

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(deployments, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'deployment-tracker-export.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJSON = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const imported = JSON.parse(reader.result as string);
        if (!Array.isArray(imported)) throw new Error('Invalid format');
        let importCount = 0;
        for (const item of imported) {
          if (!deployments.find(d => d.id === item.id)) {
            await fetch('/api/deployments', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(item)
            });
            importCount++;
          }
        }
        alert(`Imported ${importCount} entries.`);
        loadData();
      } catch (error) {
        alert('Could not import file.');
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const filteredDeployments = deployments.filter(d => {
    if (filterEnv && d.environment !== filterEnv) return false;
    if (filterStatus && d.status !== filterStatus) return false;
    if (filterDate && !d.started_at.startsWith(filterDate)) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return [d.branch, d.version, d.ticket_link, d.requested_by, d.deployed_by, d.notes, d.frontend_branch, d.backend_branch]
        .some(field => field?.toLowerCase().includes(q));
    }
    return true;
  });

  const timelineData = getTimelineData();
  const maxDayTotal = Math.max(1, ...timelineData.map(d => {
    return Object.values(d.envData).reduce((sum, v) => sum + v.success + v.failed + v.other, 0);
  }));

  const totalDeployments = deployments.length;
  const successfulDeployments = deployments.filter(d => d.status === 'Success').length;
  const successRate = totalDeployments > 0 ? ((successfulDeployments / totalDeployments) * 100).toFixed(1) : '100';
  const rollbackCount = deployments.filter(d => d.status === 'Rolled Back' || d.notes?.toLowerCase().includes('rollback')).length;
  const todayDate = new Date().toISOString().slice(0, 10);
  const todayDeployments = deployments.filter(d => d.started_at?.slice(0, 10) === todayDate).length;

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0B0F17', color: 'var(--accent)', fontFamily: 'JetBrains Mono, monospace', gap: '16px' }}>
        <div style={{ width: '40px', height: '40px', border: '3px solid rgba(56,189,248,0.2)', borderTopColor: '#38BDF8', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        <div>PROBING CLUSTERS & TELEMETRY...</div>
      </div>
    );
  }

  const compareDeployments = compareIds.length === 2
    ? [deployments.find(d => d.id === compareIds[0]), deployments.find(d => d.id === compareIds[1])]
    : [];

  return (
    <>
      <div className={`wrap ${theme}`} data-theme={theme}>
        {/* Terminal Header */}
        <header className="top">
          <div className="title-block">
            <div className="terminal-cli-bar">
              <span className="cli-prefix">$</span>
              <span className="cli-host">vidai@devops-core</span>
              <span className="cli-sep">:</span>
              <span className="cli-path">~/telemetry</span>
              <span className="cli-git"> (git:main)</span>
              <span className="cli-cmd"> # deployment-tracker --live</span>
            </div>
            <h1>DEPLOYMENT COMMAND CENTER</h1>
            <div className="sub">
              <span className={`live-dot ${isRefreshing || isProbing ? 'refreshing' : ''}`}>●</span>
              <span className="sys-badge">SYSTEMS NORMAL</span>
              <span>POLL: 60s</span>
              <span>·</span>
              <span>LAST DATA: {lastUpdated.toLocaleTimeString()}</span>
              {lastProbed && (
                <>
                  <span>·</span>
                  <span title="Last Cluster HTTP Probe">CLUSTERS: {lastProbed.toLocaleTimeString()}</span>
                </>
              )}
              <span>·</span>
              <button 
                className="probe-refresh-btn" 
                onClick={() => { loadData(); probeClusterHealth(); }}
                disabled={isRefreshing || isProbing}
                title="Force probe all cluster endpoints immediately"
              >
                {isProbing ? '⚡ PROBING...' : '🔄 PROBE NOW'}
              </button>
              <span>·</span>
              <a href="/copilot" className="copilot-pill">
                ⚡ GITHUB COPILOT METRICS ➔
              </a>
            </div>
          </div>
          <div className="actions">
            <div className="theme-selector-pill" title="Switch Dashboard Theme">
              <span 
                className="theme-dot-indicator" 
                style={{
                  background: theme === 'vidai' ? '#E17E61' : theme === 'midnight' ? '#818CF8' : theme === 'light' ? '#0284C7' : '#38BDF8'
                }} 
              />
              <select
                value={theme}
                onChange={(e) => handleThemeChange(e.target.value as ThemeMode)}
                className="theme-select-input"
                aria-label="Theme selector"
              >
                <option value="vidai">🟠 VidAI Portal (React)</option>
                <option value="dark">🌑 DevOps Dark</option>
                <option value="midnight">🌌 Midnight Indigo</option>
                <option value="light">☀️ Minimal Light</option>
              </select>
            </div>
            {isAdmin ? (
              <>
                <button className="btn ghost small" onClick={() => setShowEnvModal(true)}>⚙ Targets</button>
                <button className="btn ghost small" onClick={exportJSON}>⬇ Export</button>
                <label className="btn ghost small" style={{ margin: 0 }}>
                  ⬆ Import
                  <input ref={fileInputRef} type="file" accept="application/json" onChange={importJSON} style={{ display: 'none' }} />
                </label>
                <button className="btn primary" onClick={openNewDeploy}>+ Deploy Release</button>
                <button className="btn ghost small" onClick={() => window.location.href = '/admin'}>📊 Telemetry</button>
                <button className="btn ghost small danger" onClick={handleLogout}>Logout</button>
              </>
            ) : (
              <>
                <button className="btn ghost small" onClick={exportJSON}>⬇ Export</button>
                <button className="btn primary" onClick={() => setShowLoginModal(true)}>🔐 Admin Access</button>
              </>
            )}
          </div>
        </header>

        {/* DevOps HUD Telemetry Bar */}
        <div className="hud-telemetry">
          <div className="hud-card">
            <span className="hud-label">CLUSTER STATUS</span>
            <div className="hud-value ok">
              <span className="hud-dot ok" />
              OPERATIONAL
            </div>
          </div>
          <div className="hud-card">
            <span className="hud-label">SUCCESS RATE</span>
            <div className="hud-value accent">{successRate}%</div>
          </div>
          <div className="hud-card">
            <span className="hud-label">TOTAL RUNS</span>
            <div className="hud-value">{totalDeployments}</div>
          </div>
          <div className="hud-card">
            <span className="hud-label">TODAY&apos;S VELOCITY</span>
            <div className="hud-value accent">{todayDeployments} DEPLOYS</div>
          </div>
          <div className="hud-card">
            <span className="hud-label">TRACKED TARGETS</span>
            <div className="hud-value">{environments.length} CLUSTERS</div>
          </div>
          <div className="hud-card">
            <span className="hud-label">ROLLBACK AUDIT</span>
            <div className={`hud-value ${rollbackCount > 0 ? 'warn' : 'ok'}`}>
              {rollbackCount} {rollbackCount === 1 ? 'EVENT' : 'EVENTS'}
            </div>
          </div>
        </div>

        {/* Environment Cards */}
        <div className="cards">
          {[...environments].sort((a, b) => {
            const orderA = PROMOTION_ORDER[a.name] ?? a.displayOrder ?? 99;
            const orderB = PROMOTION_ORDER[b.name] ?? b.displayOrder ?? 99;
            return orderA - orderB;
          }).map((env) => {
            const latest = latestForEnv(env.name);
            const branches = latestBranchesForEnv(env.name);
            const health = getEnvHealth(env.name);
            const lastTimes = getLastDeployTimes(env.name);
            const clusterInfo = getClusterInfo(env.name);
            const probe = clusterHealth[env.name];

            return (
              <div
                key={env.name}
                className={`card ${env.isProd ? 'is-prod' : ''} ${health.status === 'critical' ? 'health-critical' : health.status === 'warning' ? 'health-warning' : ''}`}
              >
                <div className="stripe" style={{ background: env.isProd ? '#F97316' : '#38BDF8' }} />

                {/* Card Header: Environment Name, Cluster Subtitle, Prod Badge & Health Pill */}
                <div className="card-head">
                  <div className="card-title-col">
                    <div className="card-title-row">
                      <span className="env-title">{env.name}</span>
                      {env.isProd && <span className="prod-badge">PROD</span>}
                    </div>
                    {clusterInfo && (
                      <span className="cluster-sub">
                        {clusterInfo.region} · {clusterInfo.clusterShort}
                      </span>
                    )}
                  </div>

                  {probe && (
                    <div
                      className={`health-pill ${probe.status.toLowerCase()}`}
                      title={`${probe.message}${probe.latencyMs > 0 ? ` · ${probe.latencyMs}ms` : ''}\nEndpoint: ${probe.url}`}
                    >
                      <span className={`health-dot ${probe.status.toLowerCase()}`} />
                      <span className="health-label">{probe.status}</span>
                      {probe.latencyMs > 0 && (
                        <span className="health-ms">{probe.latencyMs}ms</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Health Alert banner if critical or warning */}
                {health.label && (
                  <div className="card-alert" style={{ borderColor: health.color, color: health.color }}>
                    <span>{health.status === 'critical' ? '⚠' : health.status === 'warning' ? '⚡' : '⏰'} {health.label}</span>
                  </div>
                )}

                {/* QA Scheduled Release Cadence & Gate (Task B) */}
                {env.name === 'QA' && (
                  <div className={`qa-release-cadence-box ${qaNextWindow.isOpen ? 'open' : qaNextWindow.isImminent ? 'imminent' : ''}`}>
                    <div className="cadence-top">
                      <div className="cadence-title-row">
                        <span className={`cadence-pulse-dot ${qaNextWindow.isOpen ? 'green' : qaNextWindow.isImminent ? 'yellow' : 'cyan'}`} />
                        <span className="cadence-badge-title">RELEASE CADENCE</span>
                      </div>
                      <span className={`cadence-pill ${qaNextWindow.isOpen ? 'open' : qaNextWindow.isImminent ? 'imminent' : ''}`}>
                        {qaNextWindow.badge}
                      </span>
                    </div>

                    <div className="cadence-time-row">
                      <div className="cadence-timer-val">{qaNextWindow.countdownText}</div>
                      <div className="cadence-rule-pill">GATE: MANDATORY APPROVAL</div>
                    </div>

                    <div className="cadence-footer-row">
                      <div className="cadence-slots">
                        <span className={`cadence-slot ${qaNextWindow.windowIndex === 0 ? 'active' : ''}`}>1:30 PM IST</span>
                        <span className="slot-dot">•</span>
                        <span className={`cadence-slot ${qaNextWindow.windowIndex === 1 ? 'active' : ''}`}>5:30 PM IST</span>
                      </div>
                      <span className="cadence-lead-tag" title="DevOps approval required from Prakash Pawar">
                        @pawarprakash-devops
                      </span>
                    </div>
                  </div>
                )}

                {latest ? (
                  <>
                    {/* Status & Version Strip */}
                    <div className="card-status-strip">
                      <div className="status-group">
                        <span className={`badge ${getStatusClass(latest.status)}`}>
                          <span className="b-dot" />
                          {latest.status.toUpperCase()}
                        </span>
                        <span className="deploy-time-text">{timeAgo(latest.started_at)}</span>
                      </div>
                      {latest.version && (
                        <span className="version-pill">🏷 {latest.version}</span>
                      )}
                    </div>

                    {/* Active Branches */}
                    <div className="card-branches">
                      {(branches.fe || branches.be) ? (
                        <>
                          <div className="branch-item" title={`Frontend: ${branches.fe || '—'}`}>
                            <span className="b-tag fe">FE</span>
                            <span className="b-text">{branches.fe || '—'}</span>
                          </div>
                          <div className="branch-item" title={`Backend: ${branches.be || '—'}`}>
                            <span className="b-tag be">BE</span>
                            <span className="b-text">{branches.be || '—'}</span>
                          </div>
                        </>
                      ) : (
                        <div className="branch-item" title={`Git Branch: ${latest.branch || '—'}`}>
                          <span className="b-tag git">GIT</span>
                          <span className="b-text">{latest.branch || '—'}</span>
                        </div>
                      )}
                    </div>

                    {/* Footer */}
                    <div className="card-footer">
                      <span className="footer-deployer" title={`Deployed by @${latest.deployed_by || latest.requested_by || 'system'}`}>
                        <UserAvatarBadge user={latest.requested_by || latest.deployed_by || 'system'} size={18} />
                      </span>
                      {(lastTimes.feAgo || lastTimes.beAgo) && (
                        <span className="footer-sync" title="Last successful deployment per component">
                          {lastTimes.feAgo ? `FE: ${lastTimes.feAgo}` : ''}
                          {lastTimes.feAgo && lastTimes.beAgo ? ' · ' : ''}
                          {lastTimes.beAgo ? `BE: ${lastTimes.beAgo}` : ''}
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="card-empty">
                    <span className="badge none"><span className="b-dot" />NO DEPLOYS YET</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Deployment Timeline */}
        <div className="timeline-section">
          <h3 className="section-title">Deployment Timeline (Last 14 Days)</h3>
          <div className="timeline">
            {timelineData.map(day => {
              const totalSuccess = Object.values(day.envData).reduce((s, v) => s + v.success, 0);
              const totalFailed = Object.values(day.envData).reduce((s, v) => s + v.failed, 0);
              const totalOther = Object.values(day.envData).reduce((s, v) => s + v.other, 0);
              const total = totalSuccess + totalFailed + totalOther;
              const barHeight = Math.max(4, (total / maxDayTotal) * 80);
              
              return (
                <div key={day.date} className="timeline-bar" title={`${day.label}: ${total} deployments (${totalSuccess} success, ${totalFailed} failed)`}>
                  <div className="bar-stack" style={{ height: `${barHeight}px` }}>
                    {totalFailed > 0 && (
                      <div className="bar-segment failed" style={{ height: `${(totalFailed / total) * 100}%` }} />
                    )}
                    {totalOther > 0 && (
                      <div className="bar-segment other" style={{ height: `${(totalOther / total) * 100}%` }} />
                    )}
                    {totalSuccess > 0 && (
                      <div className="bar-segment success" style={{ height: `${(totalSuccess / total) * 100}%` }} />
                    )}
                  </div>
                  <span className="bar-label">{day.label}</span>
                  {total > 0 && <span className="bar-count">{total}</span>}
                </div>
              );
            })}
          </div>
        </div>

        {/* Compare Bar */}
        {compareIds.length > 0 && (
          <div className="compare-bar">
            <span>{compareIds.length}/2 selected for comparison</span>
            {compareIds.length === 2 && (
              <button className="btn primary small" onClick={() => openCompare()}>
                Compare
              </button>
            )}
            <button className="btn ghost small" onClick={() => setCompareIds([])}>Clear</button>
          </div>
        )}

        {/* Filters */}
        <div className="filter-row">
          <select value={filterEnv} onChange={(e) => setFilterEnv(e.target.value)}>
            <option value="">All Environments</option>
            {environments.map((env) => (
              <option key={env.name} value={env.name}>{env.name}</option>
            ))}
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">All Statuses</option>
            <option value="Success">Success</option>
            <option value="In Progress">In Progress</option>
            <option value="Failed">Failed</option>
            <option value="Cancelled">Cancelled</option>
            <option value="Rolled Back">Rolled Back</option>
          </select>
          <input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} />
          {filterDate && (
            <button className="btn ghost small" onClick={() => setFilterDate('')}>✕ Clear date</button>
          )}
          <div className="search-wrap">
            <input type="search" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search branch, version, ticket, or names..." />
          </div>
          <div className="count">{filteredDeployments.length} {filteredDeployments.length === 1 ? 'entry' : 'entries'}</div>
        </div>

        {/* Table */}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: '40px' }}></th>
                <th>Environment</th>
                <th>Status</th>
                <th>Branch / Version</th>
                <th>Date & Time</th>
                <th>Requested By</th>
                <th>Approved By</th>
                <th>Tested By</th>
                <th>Ticket / Notes</th>
                {isAdmin && <th></th>}
              </tr>
            </thead>
            <tbody>
              {filteredDeployments.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 10 : 9} className="empty-state">
                    <div className="big">No deployments found</div>
                    <div>Try adjusting your filters or click &quot;+ New Deployment&quot; to add one.</div>
                  </td>
                </tr>
              ) : (
                filteredDeployments.map((d) => {
                  const ticketInfo = formatTicketLink(d.ticket_link, d.notes);
                  return (
                    <tr key={d.id} className={compareIds.includes(d.id) ? 'compare-selected' : ''}>
                      <td>
                        <input
                          type="checkbox"
                          checked={compareIds.includes(d.id)}
                          onChange={() => toggleCompare(d.id)}
                          title="Select to compare"
                          className="compare-check"
                        />
                      </td>
                      <td className="env-cell">{d.environment}</td>
                      <td>
                        <span className={`badge ${getStatusClass(d.status)}`}>
                          <span className="b-dot" />
                          {d.status}
                        </span>
                      </td>
                      <td>
                        {d.frontend_branch || d.backend_branch ? (
                          <div>
                            {d.frontend_branch && (
                              <div className="mono" style={{ marginBottom: '4px' }}>
                                <span style={{ color: 'var(--accent)', fontSize: '10px', fontWeight: 600 }}>FE:</span> {d.frontend_branch}
                              </div>
                            )}
                            {d.backend_branch && (
                              <div className="mono">
                                <span style={{ color: 'var(--ok)', fontSize: '10px', fontWeight: 600 }}>BE:</span> {d.backend_branch}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div>
                            <div className="mono">{d.branch || '—'}</div>
                            {d.version && <div style={{ color: 'var(--muted)', fontSize: '11.5px', marginTop: '2px' }}>{d.version}</div>}
                          </div>
                        )}
                      </td>
                      <td>
                        {new Date(d.started_at).toLocaleString()}
                        {d.duration_seconds && (
                          <div style={{ color: 'var(--faint)', fontSize: '11px' }}>{formatDuration(d.duration_seconds)}</div>
                        )}
                      </td>
                      <td className="who">
                        <UserAvatarBadge user={d.requested_by} size={18} />
                      </td>
                      <td className="who">
                        <UserAvatarBadge user={d.approved_by} size={18} />
                      </td>
                      <td className="who">
                        <UserAvatarBadge user={d.tested_by} size={18} />
                      </td>
                      <td className="notes">
                        <div className="ticket-link-cluster">
                          {ticketInfo?.url && (
                            <a href={ticketInfo.url} target="_blank" rel="noopener noreferrer" className="ticket-link" title={ticketInfo.fullText}>
                              🔗 {ticketInfo.text}
                            </a>
                          )}
                          {ticketInfo?.prUrl && (
                            <a href={ticketInfo.prUrl} target="_blank" rel="noopener noreferrer" className="pr-deep-link" title={`Direct GitHub PR: ${ticketInfo.prText}`}>
                              🔀 {ticketInfo.prText}
                            </a>
                          )}
                        </div>
                        {d.notes && <div className="note-text">{renderNoteWithLinks(d.notes)}</div>}
                      </td>
                      {isAdmin && (
                        <td>
                          <div className="row-actions">
                            <button className="btn small ghost" onClick={() => openEditDeploy(d)}>Edit</button>
                            <button className="btn small ghost danger" onClick={() => deleteDeploy(d.id)}>Del</button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <footer className="note">
          <span className={`live-dot ${isRefreshing ? 'refreshing' : ''}`}>●</span>
          {' '}Auto-refreshing every 5s · Last updated: {lastUpdated.toLocaleTimeString()} · {deployments.length} total deployments
        </footer>
      </div>

      {/* Deploy Modal */}
      {showDeployModal && (
        <div className="overlay open" onClick={(e) => e.target === e.currentTarget && setShowDeployModal(false)}>
          <div className="modal">
            <h2>{editingDeployId ? 'Edit Deployment' : 'New Deployment'}</h2>
            <div className="field-grid">
              <div className="field">
                <label>Environment <span className="req-star">*</span></label>
                <select
                  value={deployForm.environment}
                  onChange={(e) => {
                    const newEnv = e.target.value;
                    const suggestedBranch = ENV_DEFAULT_BRANCH[newEnv];
                    setDeployForm({
                      ...deployForm,
                      environment: newEnv,
                      branch: suggestedBranch || deployForm.branch
                    });
                  }}
                >
                  {[...environments].sort((a, b) => (PROMOTION_ORDER[a.name] ?? a.displayOrder ?? 99) - (PROMOTION_ORDER[b.name] ?? b.displayOrder ?? 99)).map((env) => (
                    <option key={env.name} value={env.name}>{env.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Status <span className="req-star">*</span></label>
                <select value={deployForm.status} onChange={(e) => setDeployForm({ ...deployForm, status: e.target.value })}>
                  <option>Success</option><option>In Progress</option><option>Failed</option><option>Cancelled</option><option>Rolled Back</option>
                </select>
              </div>
              <div className="field">
                <label>Branch <span className="req-star">*</span></label>
                <input
                  type="text"
                  list="standard-branches-list"
                  value={deployForm.branch}
                  onChange={(e) => setDeployForm({ ...deployForm, branch: e.target.value })}
                  placeholder="e.g. dev, qa, stage, preprod, prod_ank"
                />
                <datalist id="standard-branches-list">
                  {STANDARD_BRANCHES.map(b => (
                    <option key={b.branch} value={b.branch}>{b.label}</option>
                  ))}
                </datalist>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '6px' }}>
                  {STANDARD_BRANCHES.map(b => (
                    <button
                      key={b.branch}
                      type="button"
                      onClick={() => setDeployForm({ ...deployForm, branch: b.branch })}
                      style={{
                        padding: '2px 7px',
                        fontSize: '11px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        border: '1px solid var(--border)',
                        background: deployForm.branch === b.branch ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
                        color: deployForm.branch === b.branch ? '#fff' : 'var(--text)',
                      }}
                    >
                      {b.branch}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label>Version / Build Tag</label>
                <input type="text" value={deployForm.version} onChange={(e) => setDeployForm({ ...deployForm, version: e.target.value })} placeholder="v2.4.1-build882" />
              </div>
              <div className="field">
                <label>Date & Time <span className="req-star">*</span></label>
                <input type="datetime-local" value={deployForm.datetime} onChange={(e) => setDeployForm({ ...deployForm, datetime: e.target.value })} />
              </div>
              <div className="field">
                <label>Duration (optional)</label>
                <input type="text" value={deployForm.duration} onChange={(e) => setDeployForm({ ...deployForm, duration: e.target.value })} placeholder="e.g. 12 min" />
              </div>
              <div className="field">
                <label>Requested By <span className="req-star">*</span></label>
                <input type="text" value={deployForm.requested_by} onChange={(e) => setDeployForm({ ...deployForm, requested_by: e.target.value })} placeholder="Name" />
              </div>
              <div className="field"><label>Approved By</label><input type="text" value={deployForm.approved_by} onChange={(e) => setDeployForm({ ...deployForm, approved_by: e.target.value })} placeholder="Name" /></div>
              <div className="field"><label>Tested By</label><input type="text" value={deployForm.tested_by} onChange={(e) => setDeployForm({ ...deployForm, tested_by: e.target.value })} placeholder="Name" /></div>
              <div className="field"><label>Deployed By</label><input type="text" value={deployForm.deployed_by} onChange={(e) => setDeployForm({ ...deployForm, deployed_by: e.target.value })} placeholder="Name" /></div>
              <div className="field full"><label>Ticket / PR Link</label><input type="text" value={deployForm.ticket_link} onChange={(e) => setDeployForm({ ...deployForm, ticket_link: e.target.value })} placeholder="JIRA-1234 or PR URL" /></div>
              <div className="field full"><label>Notes</label><textarea value={deployForm.notes} onChange={(e) => setDeployForm({ ...deployForm, notes: e.target.value })} placeholder="Rollback reason, migration notes, hotfix details..." /></div>
            </div>
            <div className="modal-footer">
              <button className="btn ghost" onClick={() => setShowDeployModal(false)}>Cancel</button>
              <button className="btn primary" onClick={saveDeploy}>Save Deployment</button>
            </div>
          </div>
        </div>
      )}

      {/* Environment Modal */}
      {showEnvModal && (
        <div className="overlay open" onClick={(e) => e.target === e.currentTarget && setShowEnvModal(false)}>
          <div className="modal" style={{ minWidth: '500px' }}>
            <h2>Manage Environments</h2>
            <div style={{ marginBottom: '20px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: 'var(--muted)' }}>Current Environments</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {environments.map((env, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '6px' }}>
                    <div style={{ width: '12px', height: '12px', background: env.color, borderRadius: '3px' }}></div>
                    <span style={{ flex: 1, fontSize: '13px', fontWeight: 500 }}>
                      {env.name}
                      {env.isProd && <span style={{ marginLeft: '8px', fontSize: '10px', padding: '2px 6px', background: 'var(--prod)', color: '#0B0E14', borderRadius: '4px', fontWeight: 700 }}>LIVE</span>}
                    </span>
                    <button className="btn small danger" onClick={async () => {
                      if (confirm(`Delete "${env.name}" environment?`)) {
                        try {
                          const envs = await fetch('/api/environments');
                          const envData = await envs.json();
                          const envToDelete = envData.find((e: any) => e.name === env.name);
                          if (envToDelete) {
                            const res = await fetch(`/api/environments/${envToDelete.id}`, { method: 'DELETE' });
                            if (res.ok) loadData();
                          }
                        } catch (error) { console.error(error); }
                      }
                    }}>Delete</button>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ padding: '16px', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: '8px', marginBottom: '20px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Add New Environment</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <input type="text" placeholder="Environment name" value={newEnvForm.name} onChange={(e) => setNewEnvForm({...newEnvForm, name: e.target.value})} style={{ padding: '8px 12px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '13px' }} />
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                  <input type="checkbox" checked={newEnvForm.isProd} onChange={(e) => setNewEnvForm({...newEnvForm, isProd: e.target.checked})} />
                  Production environment
                </label>
                <button className="btn primary small" onClick={async () => {
                  if (!newEnvForm.name.trim()) { alert('Environment name is required'); return; }
                  try {
                    const res = await fetch('/api/environments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newEnvForm.name, is_production: newEnvForm.isProd, display_order: environments.length + 1 }) });
                    if (res.ok) { setNewEnvForm({ name: '', color: '#5B8DEF', isProd: false, description: '' }); loadData(); }
                    else { const error = await res.json(); alert('Error: ' + (error.error || 'Failed')); }
                  } catch (error) { alert('Failed to create environment'); }
                }}>+ Add Environment</button>
              </div>
            </div>
            <div className="modal-footer"><button className="btn ghost" onClick={() => setShowEnvModal(false)}>Done</button></div>
          </div>
        </div>
      )}

      {/* Login Modal */}
      {showLoginModal && (
        <div className="overlay open" onClick={(e) => e.target === e.currentTarget && setShowLoginModal(false)}>
          <div className="modal" style={{ minWidth: '400px' }}>
            <h2>🔐 Admin Login</h2>
            <div style={{ marginBottom: '20px', color: 'var(--muted)', fontSize: '13px' }}>Enter admin password to access management features</div>
            <input type="password" placeholder="Admin password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleLogin()} autoFocus style={{ width: '100%', padding: '12px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontSize: '14px', marginBottom: '20px' }} />
            <div className="modal-footer">
              <button className="btn ghost" onClick={() => { setShowLoginModal(false); setLoginPassword(''); }}>Cancel</button>
              <button className="btn primary" onClick={handleLogin}>Login</button>
            </div>
          </div>
        </div>
      )}

      {/* Compare Modal */}
      {showCompareModal && compareDeployments.length === 2 && compareDeployments[0] && compareDeployments[1] && (
        <div className="overlay open" onClick={(e) => e.target === e.currentTarget && setShowCompareModal(false)}>
          <div className="modal" style={{ minWidth: '750px', maxWidth: '900px', maxHeight: '90vh', overflow: 'auto' }}>
            <h2>Compare Deployments</h2>
            
            {/* Deployment Info Grid */}
            <div className="compare-grid">
              {(['environment', 'status', 'frontend_branch', 'backend_branch', 'version', 'started_at', 'requested_by', 'deployed_by', 'notes'] as const).map(field => {
                const v1 = String((compareDeployments[0] as any)?.[field] || '—');
                const v2 = String((compareDeployments[1] as any)?.[field] || '—');
                const isDiff = v1 !== v2;
                const label = field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                return (
                  <div key={field} className="compare-row">
                    <div className="compare-label">{label}</div>
                    <div className={`compare-val ${isDiff ? 'diff' : ''}`}>
                      {field === 'started_at' ? new Date(v1).toLocaleString() : v1}
                    </div>
                    <div className={`compare-val ${isDiff ? 'diff' : ''}`}>
                      {field === 'started_at' ? new Date(v2).toLocaleString() : v2}
                    </div>
                  </div>
                );
              })}
              <div className="compare-row">
                <div className="compare-label">Time Difference</div>
                <div className="compare-val" style={{ gridColumn: 'span 2', textAlign: 'center', color: 'var(--accent)' }}>
                  {formatDuration(Math.abs(Math.round((new Date(compareDeployments[0].started_at).getTime() - new Date(compareDeployments[1].started_at).getTime()) / 1000)))}
                </div>
              </div>
            </div>

            {/* Code Changes Section */}
            <div style={{ marginTop: '20px', borderTop: '1px solid var(--border)', paddingTop: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 600, margin: 0, fontFamily: 'Space Grotesk, sans-serif' }}>
                  Code Changes {compareData?.baseBranch && compareData?.headBranch && (
                    <span style={{ fontSize: '12px', fontWeight: 400, color: 'var(--muted)', marginLeft: '8px' }}>
                      ({compareData.baseBranch} → {compareData.headBranch})
                    </span>
                  )}
                </h3>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    className={`btn small ${compareRepo.includes('vidai-react') ? 'primary' : 'ghost'}`}
                    onClick={() => openCompare('vidaisolutions/vidai-react')}
                  >
                    Frontend (vidai-react)
                  </button>
                  <button
                    type="button"
                    className={`btn small ${compareRepo.includes('vidai-backend') ? 'primary' : 'ghost'}`}
                    onClick={() => openCompare('vidaisolutions/vidai-backend')}
                  >
                    Backend (vidai-backend)
                  </button>
                </div>
              </div>

              {compareLoading && (
                <div style={{ textAlign: 'center', padding: '20px', color: 'var(--muted)' }}>
                  Loading commits from GitHub...
                </div>
              )}

              {!compareLoading && !compareData && (
                <div style={{ textAlign: 'center', padding: '20px', color: 'var(--faint)' }}>
                  Could not fetch code changes. GitHub token may not have access to the repository.
                </div>
              )}

              {!compareLoading && compareData && (
                <>
                  {/* Summary */}
                  <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
                    <div className="code-stat">
                      <span className="code-stat-num">{compareData.total_commits || 0}</span>
                      <span className="code-stat-label">Commits</span>
                    </div>
                    {compareData.files_changed !== undefined && (
                      <div className="code-stat">
                        <span className="code-stat-num">{compareData.files_changed}</span>
                        <span className="code-stat-label">Files Changed</span>
                      </div>
                    )}
                    {compareData.repo && (
                      <div className="code-stat">
                        <span className="code-stat-num" style={{ fontSize: '12px' }}>{compareData.repo.split('/')[1]}</span>
                        <span className="code-stat-label">Repository</span>
                      </div>
                    )}
                  </div>

                  {compareData.fallback && (
                    <div style={{ fontSize: '12px', color: 'var(--warn)', marginBottom: '12px', padding: '8px', background: 'var(--warn-bg)', borderRadius: '6px' }}>
                      Showing recent commits on branch (exact diff unavailable — branches may be same or merged)
                    </div>
                  )}

                  {/* Commits List */}
                  {compareData.commits && compareData.commits.length > 0 && (
                    <div style={{ marginBottom: '16px' }}>
                      <h4 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--muted)', margin: '0 0 10px' }}>
                        COMMITS ({compareData.commits.length})
                      </h4>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '300px', overflowY: 'auto' }}>
                        {compareData.commits.map((c: any) => (
                          <div key={c.sha} style={{
                            padding: '10px 12px',
                            background: 'var(--panel-2)',
                            border: '1px solid var(--border)',
                            borderRadius: '6px',
                            fontSize: '13px'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 500, marginBottom: '4px', lineHeight: 1.4 }}>
                                  {c.message.split('\n')[0]}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--muted)' }}>
                                  {c.author_avatar && (
                                    <img src={c.author_avatar} alt="" style={{ width: '16px', height: '16px', borderRadius: '50%' }} />
                                  )}
                                  <span style={{ fontWeight: 600 }}>{c.author_login || c.author}</span>
                                  <span>{new Date(c.date).toLocaleString()}</span>
                                </div>
                              </div>
                              <a href={c.url} target="_blank" rel="noopener noreferrer" style={{
                                fontFamily: 'JetBrains Mono, monospace',
                                fontSize: '11px',
                                color: 'var(--accent)',
                                background: 'rgba(91,141,239,0.08)',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                textDecoration: 'none',
                                whiteSpace: 'nowrap'
                              }}>
                                {c.short_sha}
                              </a>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Files Changed */}
                  {compareData.files && compareData.files.length > 0 && (
                    <div>
                      <h4 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--muted)', margin: '0 0 10px' }}>
                        FILES CHANGED ({compareData.files_changed})
                      </h4>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '250px', overflowY: 'auto' }}>
                        {compareData.files.map((f: any, idx: number) => (
                          <div key={idx} style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '6px 10px',
                            background: 'var(--panel-2)',
                            borderRadius: '4px',
                            fontSize: '12px',
                            fontFamily: 'JetBrains Mono, monospace'
                          }}>
                            <span style={{
                              fontSize: '10px',
                              fontWeight: 700,
                              padding: '1px 5px',
                              borderRadius: '3px',
                              color: '#fff',
                              background: f.status === 'added' ? 'var(--ok)' : f.status === 'removed' ? 'var(--bad)' : f.status === 'renamed' ? 'var(--warn)' : 'var(--accent)'
                            }}>
                              {f.status === 'added' ? 'A' : f.status === 'removed' ? 'D' : f.status === 'renamed' ? 'R' : 'M'}
                            </span>
                            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {f.filename}
                            </span>
                            <span style={{ color: 'var(--ok)', fontSize: '11px' }}>+{f.additions}</span>
                            <span style={{ color: 'var(--bad)', fontSize: '11px' }}>-{f.deletions}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn ghost" onClick={() => { setShowCompareModal(false); setCompareIds([]); setCompareData(null); }}>Close</button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

        :global(*) { box-sizing: border-box; }
        :global(body) {
          margin: 0;
          min-height: 100vh;
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          transition: background .3s, color .3s;
        }

        .wrap {
          width: 100%;
          max-width: none;
          margin: 0;
          padding: 24px clamp(16px, 2.5vw, 32px) 80px;
          background: var(--bg);
          color: var(--text);
          min-height: 100vh;
          transition: background .3s, color .3s;
        }

        /* 1. VidAI React Official Website Theme */
        .wrap.vidai {
          --bg: #F5F6F9;
          --text: #232323;
          --muted: #505050;
          --faint: #757575;
          --panel: #FFFFFF;
          --panel-2: #F0F2F5;
          --border: #E2E4E8;
          --border-bright: #CBD0D8;
          --accent: #E17E61; /* Official VidAI Orange from vidai-react */
          --ok: #2E7D32;     /* Dark readable green */
          --warn: #D97706;    /* Dark readable amber */
          --bad: #DC2626;     /* Dark readable red */
          --prod: #E17E61;
          --ok-bg: rgba(46, 125, 50, 0.1);
          --warn-bg: rgba(217, 119, 6, 0.1);
          --bad-bg: rgba(220, 38, 38, 0.1);
          --neutral-bg: rgba(100, 116, 139, 0.1);
          --neutral: #505050;
          --card-shadow: 0 4px 14px rgba(35, 35, 35, 0.06);
          background-color: #F5F6F9;
          background-image:
            radial-gradient(ellipse 70% 40% at 50% -10%, rgba(225, 126, 97, 0.08), transparent),
            radial-gradient(circle at 90% 10%, rgba(90, 138, 234, 0.05), transparent);
          font-family: 'Nunito', 'Montserrat', 'Inter', system-ui, -apple-system, sans-serif;
          color: #232323;
        }

        .wrap.vidai * {
          border-color: var(--border);
        }

        .wrap.vidai .terminal-cli-bar {
          background: #FFFFFF;
          border: 1px solid #E2E4E8;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04);
        }
        .wrap.vidai .terminal-cli-bar .cli-prefix { color: #E17E61; }
        .wrap.vidai .terminal-cli-bar .cli-host { color: #232323; font-weight: 700; }
        .wrap.vidai .terminal-cli-bar .cli-sep { color: #8E8E93; }
        .wrap.vidai .terminal-cli-bar .cli-path { color: #E17E61; font-weight: 600; }
        .wrap.vidai .terminal-cli-bar .cli-git { color: #505050; }
        .wrap.vidai .terminal-cli-bar .cli-cmd { color: #64748B; }

        .wrap.vidai .title-block h1 {
          font-family: 'Montserrat', sans-serif;
          color: #232323;
        }
        .wrap.vidai .title-block .sub {
          color: #505050;
        }
        .wrap.vidai .sys-badge {
          background: rgba(46, 125, 50, 0.1);
          color: #2E7D32;
          border: 1px solid rgba(46, 125, 50, 0.3);
        }
        .wrap.vidai .copilot-pill {
          background: rgba(147, 51, 234, 0.08);
          color: #7E22CE;
          border: 1px solid rgba(147, 51, 234, 0.25);
        }
        .wrap.vidai .probe-refresh-btn {
          background: rgba(225, 126, 97, 0.1);
          border: 1px solid rgba(225, 126, 97, 0.3);
          color: #E17E61;
        }
        .wrap.vidai .probe-refresh-btn:hover:not(:disabled) {
          background: rgba(225, 126, 97, 0.2);
        }

        .wrap.vidai .hud-telemetry {
          background: #FFFFFF;
          border: 1px solid #E2E4E8;
          box-shadow: 0 4px 14px rgba(35, 35, 35, 0.05);
        }
        .wrap.vidai .hud-card {
          background: #F8F9FA;
          border: 1px solid #E2E4E8;
        }
        .wrap.vidai .hud-label {
          color: #505050;
        }
        .wrap.vidai .hud-value {
          color: #232323;
        }
        .wrap.vidai .hud-value.accent {
          color: #E17E61;
        }
        .wrap.vidai .hud-value.ok {
          color: #2E7D32;
        }
        .wrap.vidai .hud-value.warn {
          color: #D97706;
        }

        .wrap.vidai .card {
          background: #FFFFFF;
          border: 1px solid #E2E4E8;
          box-shadow: 0 4px 14px rgba(35, 35, 35, 0.06);
          border-radius: 10px;
        }
        .wrap.vidai .card:hover {
          border-color: #E17E61;
          box-shadow: 0 8px 24px rgba(225, 126, 97, 0.12);
        }
        .wrap.vidai .env-title {
          color: #232323;
        }
        .wrap.vidai .cluster-sub {
          color: #505050;
        }
        .wrap.vidai .prod-badge {
          background: rgba(225, 126, 97, 0.12);
          color: #E17E61;
          border: 1px solid rgba(225, 126, 97, 0.3);
        }
        .wrap.vidai .deploy-time-text {
          color: #505050;
        }
        .wrap.vidai .version-pill {
          background: rgba(225, 126, 97, 0.1);
          color: #C25638;
          border: 1px solid rgba(225, 126, 97, 0.25);
          font-weight: 700;
        }
        .wrap.vidai .card-branches {
          background: #F8F9FA;
          border: 1px solid #E2E4E8;
        }
        .wrap.vidai .b-text {
          color: #232323;
        }
        .wrap.vidai .b-tag.fe {
          background: rgba(2, 132, 199, 0.1);
          color: #0284C7;
          border: 1px solid rgba(2, 132, 199, 0.25);
        }
        .wrap.vidai .b-tag.be {
          background: rgba(225, 126, 97, 0.12);
          color: #D06C4E;
          border: 1px solid rgba(225, 126, 97, 0.25);
        }
        .wrap.vidai .b-tag.git {
          background: rgba(100, 116, 139, 0.1);
          color: #475569;
          border: 1px solid rgba(100, 116, 139, 0.2);
        }
        .wrap.vidai .card-footer {
          border-top: 1px solid #E2E4E8;
          color: #505050;
        }
        .wrap.vidai .footer-deployer {
          color: #505050;
        }
        .wrap.vidai .footer-sync {
          color: #757575;
        }

        .wrap.vidai .health-pill.healthy {
          background: rgba(46, 125, 50, 0.1);
          border: 1px solid rgba(46, 125, 50, 0.3);
          color: #2E7D32;
        }
        .wrap.vidai .health-pill.degraded {
          background: rgba(217, 119, 6, 0.1);
          border: 1px solid rgba(217, 119, 6, 0.3);
          color: #B45309;
        }
        .wrap.vidai .health-pill.offline {
          background: rgba(220, 38, 38, 0.1);
          border: 1px solid rgba(220, 38, 38, 0.3);
          color: #DC2626;
        }

        .wrap.vidai .badge.success {
          background: rgba(46, 125, 50, 0.1);
          color: #2E7D32;
          border: 1px solid rgba(46, 125, 50, 0.3);
        }
        .wrap.vidai .badge.failed {
          background: rgba(220, 38, 38, 0.1);
          color: #DC2626;
          border: 1px solid rgba(220, 38, 38, 0.3);
        }
        .wrap.vidai .badge.progress {
          background: rgba(217, 119, 6, 0.1);
          color: #B45309;
          border: 1px solid rgba(217, 119, 6, 0.3);
        }
        .wrap.vidai .badge.rollback,
        .wrap.vidai .badge.cancelled {
          background: rgba(100, 116, 139, 0.1);
          color: #475569;
          border: 1px solid rgba(100, 116, 139, 0.25);
        }

        .wrap.vidai .btn {
          border-radius: 10px;
          background: #F0F2F5;
          border: 1px solid #E2E4E8;
          color: #232323;
        }
        .wrap.vidai .btn:hover {
          border-color: #E17E61;
          color: #E17E61;
        }
        .wrap.vidai .btn.ghost {
          background: transparent;
          color: #232323;
        }
        .wrap.vidai .btn.primary {
          background: #E17E61;
          border-color: #E17E61;
          color: #FFFFFF;
          font-weight: 700;
        }
        .wrap.vidai .btn.primary:hover {
          background: #D06C4E;
          border-color: #D06C4E;
        }

        .wrap.vidai .theme-selector-pill {
          background: #FFFFFF;
          border: 1px solid #E2E4E8;
          color: #232323;
        }
        .wrap.vidai .theme-select-input {
          color: #232323;
        }
        .wrap.vidai .theme-select-input option {
          background: #FFFFFF;
          color: #232323;
        }

        .wrap.vidai .timeline {
          background: #FFFFFF;
          border: 1px solid #E2E4E8;
        }
        .wrap.vidai .section-title {
          color: #232323;
        }
        .wrap.vidai .bar-label {
          color: #505050;
        }
        .wrap.vidai .bar-count {
          color: #232323;
        }

        .wrap.vidai .table-wrap {
          background: #FFFFFF;
          border: 1px solid #E2E4E8;
          box-shadow: 0 4px 14px rgba(35, 35, 35, 0.05);
        }
        .wrap.vidai table {
          color: #232323;
        }
        .wrap.vidai thead th {
          background: #F8F9FA;
          color: #505050;
          border-bottom: 1px solid #E2E4E8;
        }
        .wrap.vidai tbody td {
          color: #232323;
          border-bottom: 1px solid #E2E4E8;
        }
        .wrap.vidai tbody tr:hover {
          background: #F5F6F8;
        }
        .wrap.vidai td.env-cell {
          color: #232323;
        }
        .wrap.vidai td .mono {
          color: #E17E61;
        }
        .wrap.vidai td.who {
          color: #505050;
        }
        .wrap.vidai td.notes {
          color: #505050;
        }
        .wrap.vidai .ticket-link {
          background: rgba(225, 126, 97, 0.1);
          border: 1px solid rgba(225, 126, 97, 0.3);
          color: #D06C4E;
        }
        .wrap.vidai select,
        .wrap.vidai input[type=text],
        .wrap.vidai input[type=search],
        .wrap.vidai input[type=date],
        .wrap.vidai textarea {
          background: #FFFFFF;
          border: 1px solid #E2E4E8;
          color: #232323;
        }
        .wrap.vidai select:focus,
        .wrap.vidai input:focus,
        .wrap.vidai textarea:focus {
          border-color: #E17E61;
          box-shadow: 0 0 0 2px rgba(225, 126, 97, 0.2);
        }
        .wrap.vidai .filter-row .count {
          color: #505050;
        }
        .wrap.vidai .compare-bar {
          background: #FFFFFF;
          border: 1px solid #E17E61;
          color: #E17E61;
        }
        .wrap.vidai .compare-label {
          color: #505050;
          border-bottom: 1px solid #E2E4E8;
        }
        .wrap.vidai .compare-val {
          color: #232323;
          border-bottom: 1px solid #E2E4E8;
        }
        .wrap.vidai .modal {
          background: #FFFFFF;
          border: 1px solid #CBD0D8;
          box-shadow: 0 16px 40px rgba(0, 0, 0, 0.15);
          color: #232323;
        }
        .wrap.vidai .modal h2 {
          color: #232323;
        }

        /* 2. Dark Theme (DevOps / Modern Console) */
        .wrap.dark {
          --bg: #0B0F17;
          --text: #F1F5F9;
          --muted: #94A3B8;
          --faint: #64748B;
          --panel: #0F172A;
          --panel-2: #1E293B;
          --border: rgba(255, 255, 255, 0.08);
          --border-bright: rgba(255, 255, 255, 0.16);
          --accent: #38BDF8;
          --ok: #10B981;
          --warn: #F59E0B;
          --bad: #F43F5E;
          --prod: #F97316;
          --ok-bg: rgba(16, 185, 129, 0.12);
          --warn-bg: rgba(245, 158, 11, 0.12);
          --bad-bg: rgba(244, 63, 94, 0.12);
          --neutral-bg: rgba(148, 163, 184, 0.12);
          --neutral: #94A3B8;
          --card-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
          background-color: #0B0F17;
          background-image:
            radial-gradient(ellipse 80% 50% at 50% -15%, rgba(56, 189, 248, 0.05), transparent),
            radial-gradient(circle at 100% 0%, rgba(99, 102, 241, 0.04), transparent);
          color: #F1F5F9;
        }

        /* 3. Midnight Indigo Theme */
        .wrap.midnight {
          --bg: #090D16;
          --text: #E2E8F0;
          --muted: #94A3B8;
          --faint: #64748B;
          --panel: #0F1629;
          --panel-2: #18223C;
          --border: rgba(99, 102, 241, 0.18);
          --border-bright: rgba(99, 102, 241, 0.32);
          --accent: #818CF8;
          --ok: #34D399;
          --warn: #FBBF24;
          --bad: #F87171;
          --prod: #F472B6;
          --ok-bg: rgba(52, 211, 153, 0.12);
          --warn-bg: rgba(251, 191, 36, 0.12);
          --bad-bg: rgba(248, 113, 113, 0.12);
          --neutral-bg: rgba(148, 163, 184, 0.12);
          --neutral: #94A3B8;
          --card-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
          background-color: #090D16;
          background-image:
            radial-gradient(ellipse 80% 50% at 50% -15%, rgba(99, 102, 241, 0.08), transparent),
            radial-gradient(circle at 100% 0%, rgba(139, 92, 246, 0.06), transparent);
          color: #E2E8F0;
        }
        .wrap.midnight .btn.primary {
          background: #6366F1;
          border-color: #6366F1;
          color: #FFFFFF;
        }
        .wrap.midnight .btn.primary:hover {
          background: #4F46E5;
          border-color: #4F46E5;
        }

        /* 4. Minimal Light Theme */
        .wrap.light {
          --bg: #F8FAFC;
          --text: #0F172A;
          --muted: #475569;
          --faint: #64748B;
          --panel: #FFFFFF;
          --panel-2: #F1F5F9;
          --border: #E2E8F0;
          --border-bright: #CBD5E1;
          --accent: #0284C7;
          --ok: #059669;
          --warn: #D97706;
          --bad: #DC2626;
          --prod: #EA580C;
          --ok-bg: rgba(5, 150, 105, 0.1);
          --warn-bg: rgba(217, 119, 6, 0.1);
          --bad-bg: rgba(220, 38, 38, 0.1);
          --neutral-bg: rgba(100, 116, 139, 0.1);
          --neutral: #64748B;
          --card-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
          background-color: #F8FAFC;
          color: #0F172A;
        }
        .wrap.light .terminal-cli-bar {
          background: #FFFFFF;
          border: 1px solid #E2E8F0;
        }
        .wrap.light .terminal-cli-bar .cli-host { color: #0F172A; font-weight: 700; }
        .wrap.light select,
        .wrap.light input[type=text],
        .wrap.light input[type=search],
        .wrap.light input[type=date],
        .wrap.light textarea {
          background: #FFFFFF;
          border: 1px solid #E2E8F0;
          color: #0F172A;
        }

        header.top {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          flex-wrap: wrap;
          gap: 16px;
          margin-bottom: 20px;
          padding-bottom: 18px;
          border-bottom: 1px solid var(--border);
        }

        .terminal-cli-bar {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: rgba(15, 23, 42, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.08);
          padding: 4px 10px;
          border-radius: 6px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          margin-bottom: 8px;
        }
        .cli-prefix { color: var(--ok); font-weight: 700; }
        .cli-host { color: var(--accent); }
        .cli-sep { color: var(--faint); }
        .cli-path { color: #F59E0B; }
        .cli-git { color: var(--muted); }
        .cli-cmd { color: var(--faint); }

        .title-block h1 {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 24px;
          font-weight: 700;
          margin: 0 0 6px;
          letter-spacing: -0.01em;
          color: var(--text);
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .title-block .sub {
          color: var(--muted);
          font-size: 12px;
          font-family: 'JetBrains Mono', monospace;
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .live-dot {
          color: var(--ok);
          animation: livePulse 2s infinite;
          display: inline-block;
          font-size: 14px;
        }
        .live-dot.refreshing {
          animation: liveRefresh 0.3s ease;
          color: var(--accent);
        }
        @keyframes livePulse {
          0%, 100% { opacity: 1; filter: drop-shadow(0 0 4px var(--ok)); }
          50% { opacity: 0.3; }
        }
        @keyframes liveRefresh {
          0% { transform: scale(1); }
          50% { transform: scale(1.6); }
          100% { transform: scale(1); }
        }

        .sys-badge {
          background: var(--ok-bg);
          color: var(--ok);
          border: 1px solid rgba(16, 185, 129, 0.25);
          padding: 2px 7px;
          border-radius: 4px;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.05em;
        }

        .copilot-pill {
          color: #c084fc;
          text-decoration: none;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          font-weight: 600;
          padding: 3px 9px;
          background: rgba(192, 132, 252, 0.1);
          border: 1px solid rgba(192, 132, 252, 0.25);
          border-radius: 4px;
          transition: all 0.2s;
        }
        .copilot-pill:hover {
          background: rgba(192, 132, 252, 0.2);
          box-shadow: 0 0 12px rgba(192, 132, 252, 0.35);
          color: #e9d5ff;
        }

        .probe-refresh-btn {
          background: rgba(56, 189, 248, 0.08);
          border: 1px solid rgba(56, 189, 248, 0.25);
          color: var(--accent);
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          font-weight: 700;
          padding: 2px 7px;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .probe-refresh-btn:hover:not(:disabled) {
          background: rgba(56, 189, 248, 0.18);
          border-color: rgba(56, 189, 248, 0.4);
        }
        .probe-refresh-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
        }

        .theme-selector-pill {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          background: var(--panel-2);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 5px 10px;
          transition: all 0.15s ease;
          font-family: 'JetBrains Mono', monospace;
        }
        .theme-selector-pill:hover {
          border-color: var(--accent);
        }
        .theme-dot-indicator {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
          box-shadow: 0 0 6px currentColor;
        }
        .theme-select-input {
          background: transparent;
          border: none;
          color: var(--text);
          font-family: inherit;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          outline: none;
          padding: 0;
          margin: 0;
        }
        .theme-select-input option {
          background: var(--panel);
          color: var(--text);
          padding: 6px;
        }

        button { font-family: inherit; cursor: pointer; }
        .btn {
          background: var(--panel-2);
          border: 1px solid var(--border);
          color: var(--text);
          padding: 8px 14px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          font-family: 'JetBrains Mono', monospace;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          transition: all 0.15s ease-in-out;
        }
        .btn:hover {
          border-color: var(--accent);
          color: var(--accent);
        }
        .btn.primary {
          background: #0284C7;
          border-color: #0284C7;
          color: #FFFFFF;
          font-weight: 600;
        }
        .btn.primary:hover {
          background: #0369A1;
          border-color: #0369A1;
        }
        .btn.ghost { background: transparent; }
        .btn.small { padding: 6px 10px; font-size: 11px; }
        .btn.danger:hover {
          border-color: var(--bad);
          color: var(--bad);
        }

        /* HUD Telemetry Ribbon */
        .hud-telemetry {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
          gap: 12px;
          margin-bottom: 24px;
          padding: 12px;
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: 10px;
          box-shadow: var(--card-shadow, 0 4px 14px rgba(0, 0, 0, 0.25));
        }
        .hud-card {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 10px 14px;
          background: var(--panel-2);
          border: 1px solid var(--border);
          border-radius: 6px;
        }
        .hud-label {
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          color: var(--muted);
          letter-spacing: 0.06em;
          font-weight: 600;
        }
        .hud-value {
          font-family: 'JetBrains Mono', monospace;
          font-size: 16px;
          font-weight: 700;
          color: var(--text);
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .hud-value.ok { color: var(--ok); }
        .hud-value.accent { color: var(--accent); }
        .hud-value.warn { color: var(--warn); }
        .hud-dot.ok {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--ok);
          box-shadow: 0 0 6px var(--ok);
        }

        /* Environment Cards Grid */
        .cards {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(310px, 1fr));
          gap: 16px;
          margin-bottom: 32px;
        }
        .card {
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 16px;
          position: relative;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          gap: 12px;
          transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
          box-shadow: var(--card-shadow, 0 4px 12px rgba(0, 0, 0, 0.25));
        }
        .card:hover {
          border-color: var(--accent);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
          transform: translateY(-2px);
        }
        .card.is-prod {
          border-color: rgba(249, 115, 22, 0.3);
        }
        .card.is-prod:hover {
          border-color: rgba(249, 115, 22, 0.6);
          box-shadow: 0 8px 24px rgba(249, 115, 22, 0.12);
        }
        .card.health-critical {
          border-color: var(--bad);
          box-shadow: 0 0 16px rgba(244, 63, 94, 0.2);
        }
        .card.health-warning {
          border-color: var(--warn);
        }
        .card .stripe {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
        }

        .card-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 8px;
        }
        .card-title-col {
          display: flex;
          flex-direction: column;
          gap: 3px;
          min-width: 0;
        }
        .card-title-row {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .env-title {
          font-family: 'Space Grotesk', sans-serif;
          font-weight: 700;
          font-size: 15px;
          color: var(--text);
          letter-spacing: -0.01em;
        }
        .prod-badge {
          font-size: 9px;
          font-weight: 700;
          padding: 1px 6px;
          border-radius: 4px;
          background: rgba(249, 115, 22, 0.15);
          color: #FB923C;
          border: 1px solid rgba(249, 115, 22, 0.35);
          font-family: 'JetBrains Mono', monospace;
          letter-spacing: 0.05em;
        }
        .cluster-sub {
          font-size: 11px;
          color: var(--muted);
          font-family: 'JetBrains Mono', monospace;
          letter-spacing: 0.01em;
        }

        .health-pill {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 3px 8px;
          border-radius: 6px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.03em;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .health-pill.healthy {
          background: rgba(16, 185, 129, 0.12);
          border: 1px solid rgba(16, 185, 129, 0.25);
          color: #34D399;
        }
        .health-pill.degraded {
          background: rgba(245, 158, 11, 0.12);
          border: 1px solid rgba(245, 158, 11, 0.3);
          color: #FBBF24;
        }
        .health-pill.offline {
          background: rgba(244, 63, 94, 0.12);
          border: 1px solid rgba(244, 63, 94, 0.25);
          color: #FB7185;
        }
        .health-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .health-dot.healthy { background: #34D399; }
        .health-dot.degraded { background: #FBBF24; }
        .health-dot.offline { background: #FB7185; }
        .health-label { font-size: 10px; }
        .health-ms {
          font-size: 9px;
          opacity: 0.8;
          font-weight: 500;
        }

        .card-alert {
          font-size: 11px;
          font-weight: 600;
          padding: 4px 8px;
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid;
          font-family: 'JetBrains Mono', monospace;
        }

        .card-status-strip {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .status-group {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .deploy-time-text {
          font-size: 11px;
          color: var(--muted);
          font-family: 'JetBrains Mono', monospace;
        }
        .version-pill {
          font-size: 10px;
          font-family: 'JetBrains Mono', monospace;
          color: var(--accent);
          background: rgba(56, 189, 248, 0.08);
          border: 1px solid rgba(56, 189, 248, 0.2);
          padding: 2px 7px;
          border-radius: 4px;
          font-weight: 600;
        }

        .badge {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 10.5px;
          font-weight: 700;
          font-family: 'JetBrains Mono', monospace;
          letter-spacing: .03em;
          width: fit-content;
        }
        .b-dot { width: 6px; height: 6px; border-radius: 50%; }
        .badge.success { background: rgba(16, 185, 129, 0.12); color: #34D399; border: 1px solid rgba(16, 185, 129, 0.25); }
        .badge.success .b-dot { background: #34D399; }
        .badge.progress { background: rgba(245, 158, 11, 0.12); color: #FBBF24; border: 1px solid rgba(245, 158, 11, 0.25); }
        .badge.progress .b-dot { background: #FBBF24; animation: pulse 1.4s infinite; }
        .badge.failed { background: rgba(244, 63, 94, 0.12); color: #FB7185; border: 1px solid rgba(244, 63, 94, 0.25); }
        .badge.failed .b-dot { background: #FB7185; }
        .badge.rollback { background: rgba(148, 163, 184, 0.12); color: #94A3B8; border: 1px solid rgba(148, 163, 184, 0.25); }
        .badge.rollback .b-dot { background: #94A3B8; }
        .badge.cancelled { background: rgba(148, 163, 184, 0.12); color: #94A3B8; }
        .badge.cancelled .b-dot { background: #94A3B8; }
        .badge.none { background: rgba(255, 255, 255, 0.04); color: var(--faint); font-family: 'JetBrains Mono', monospace; }
        .badge.none .b-dot { background: var(--faint); }

        .card-branches {
          background: var(--panel-2);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 8px 10px;
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .branch-item {
          display: flex;
          align-items: center;
          gap: 7px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          min-width: 0;
        }
        .b-tag {
          font-size: 9px;
          font-weight: 700;
          padding: 1px 5px;
          border-radius: 3px;
          flex-shrink: 0;
          letter-spacing: 0.02em;
        }
        .b-tag.fe {
          background: rgba(56, 189, 248, 0.14);
          color: #38BDF8;
          border: 1px solid rgba(56, 189, 248, 0.25);
        }
        .b-tag.be {
          background: rgba(129, 140, 248, 0.14);
          color: #818CF8;
          border: 1px solid rgba(129, 140, 248, 0.25);
        }
        .b-tag.git {
          background: rgba(148, 163, 184, 0.14);
          color: #94A3B8;
          border: 1px solid rgba(148, 163, 184, 0.25);
        }
        .b-text {
          color: var(--text);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-weight: 500;
        }

        .card-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          font-size: 11px;
          color: var(--muted);
          padding-top: 6px;
          border-top: 1px solid var(--border);
          font-family: 'JetBrains Mono', monospace;
        }
        .footer-deployer {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          color: var(--muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 150px;
        }
        .footer-sync {
          font-size: 10px;
          color: var(--faint);
          white-space: nowrap;
        }
        .card-empty {
          padding: 12px 0;
        }

        /* Timeline */
        .timeline-section { margin-bottom: 28px; }
        .section-title {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 15px;
          font-weight: 700;
          margin: 0 0 12px;
          letter-spacing: 0.02em;
          color: var(--text);
        }
        .timeline {
          display: flex;
          gap: 6px;
          align-items: flex-end;
          height: 120px;
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 16px 14px 8px;
          overflow-x: auto;
        }
        .timeline-bar {
          flex: 1;
          min-width: 36px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          cursor: default;
        }
        .bar-stack {
          display: flex;
          flex-direction: column-reverse;
          width: 100%;
          max-width: 36px;
          border-radius: 3px 3px 0 0;
          overflow: hidden;
          transition: height .3s;
        }
        .bar-segment { width: 100%; min-height: 2px; }
        .bar-segment.success { background: var(--ok); box-shadow: 0 0 6px rgba(0, 255, 157, 0.4); }
        .bar-segment.failed { background: var(--bad); }
        .bar-segment.other { background: var(--warn); }
        .bar-label { font-size: 9.5px; font-family: 'JetBrains Mono', monospace; color: var(--faint); white-space: nowrap; }
        .bar-count { font-size: 10px; font-family: 'JetBrains Mono', monospace; color: var(--muted); font-weight: 700; }

        /* Compare */
        .compare-bar {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 16px;
          background: var(--panel);
          border: 1px solid var(--accent);
          border-radius: 8px;
          margin-bottom: 16px;
          font-size: 12px;
          font-family: 'JetBrains Mono', monospace;
          color: var(--accent);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        }
        .compare-check { cursor: pointer; accent-color: var(--accent); }
        tr.compare-selected { background: rgba(56, 189, 248, 0.06) !important; }
        .compare-grid { display: grid; grid-template-columns: 140px 1fr 1fr; gap: 0; }
        .compare-row { display: contents; }
        .compare-label {
          padding: 8px 12px;
          font-size: 11px;
          font-weight: 700;
          color: var(--muted);
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          font-family: 'JetBrains Mono', monospace;
        }
        .compare-val {
          padding: 8px 12px;
          font-size: 12px;
          border-bottom: 1px solid var(--border);
          font-family: 'JetBrains Mono', monospace;
          word-break: break-all;
        }
        .compare-val.diff {
          background: rgba(56, 189, 248, 0.1);
          color: var(--accent);
          font-weight: 600;
        }

        .code-stat {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          padding: 10px 16px;
          background: var(--panel-2);
          border: 1px solid var(--border);
          border-radius: 8px;
          min-width: 80px;
        }
        .code-stat-num { font-size: 20px; font-weight: 700; color: var(--accent); font-family: 'JetBrains Mono', monospace; }
        .code-stat-label { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; font-family: 'JetBrains Mono', monospace; }

        .filter-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 16px; }
        select, input[type=text], input[type=search], input[type=date], textarea {
          background: var(--panel-2);
          border: 1px solid var(--border);
          color: var(--text);
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 12.5px;
          font-family: 'JetBrains Mono', monospace;
          transition: border-color 0.15s;
        }
        select:focus, input:focus, textarea:focus {
          outline: none;
          border-color: var(--accent);
          box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.2);
        }
        .wrap.dark input[type=date], .wrap.dark input[type=datetime-local] { color-scheme: dark; }
        .wrap.light input[type=date], .wrap.light input[type=datetime-local] { color-scheme: light; }
        input[type=datetime-local] {
          background: var(--panel-2);
          border: 1px solid var(--border);
          color: var(--text);
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 12.5px;
          font-family: 'JetBrains Mono', monospace;
        }
        .search-wrap { flex: 1; min-width: 240px; }
        .search-wrap input { width: 100%; }
        .filter-row .count {
          margin-left: auto;
          color: var(--faint);
          font-size: 11.5px;
          font-family: 'JetBrains Mono', monospace;
        }

        .table-wrap {
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: 10px;
          overflow-x: auto;
          overflow-y: hidden;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
        }
        table { width: 100%; border-collapse: collapse; font-size: 12.5px; min-width: 1100px; }
        thead th {
          text-align: left;
          padding: 10px 14px;
          background: var(--panel-2);
          color: var(--muted);
          font-weight: 700;
          font-size: 10.5px;
          text-transform: uppercase;
          letter-spacing: .06em;
          border-bottom: 1px solid var(--border);
          white-space: nowrap;
          font-family: 'JetBrains Mono', monospace;
        }
        tbody td {
          padding: 12px 14px;
          border-bottom: 1px solid var(--border);
          vertical-align: middle;
        }
        tbody tr:last-child td { border-bottom: none; }
        tbody tr:hover { background: rgba(255, 255, 255, 0.02); }
        td.env-cell { font-weight: 700; font-family: 'Space Grotesk', sans-serif; }
        td .mono { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; color: var(--accent); }
        td.who { color: var(--muted); font-size: 12px; font-family: 'JetBrains Mono', monospace; }
        td.notes { color: var(--muted); max-width: 220px; font-size: 12px; }
        .row-actions { display: flex; gap: 6px; }
        .empty-state { padding: 60px 20px; text-align: center; color: var(--faint); font-family: 'JetBrains Mono', monospace; }
        .empty-state .big { font-size: 15px; color: var(--muted); margin-bottom: 6px; }

        .ticket-link {
          color: var(--accent);
          text-decoration: none;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11.5px;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 6px;
          background: rgba(56, 189, 248, 0.08);
          border: 1px solid rgba(56, 189, 248, 0.2);
          border-radius: 4px;
          transition: .15s;
        }
        .ticket-link:hover {
          background: rgba(56, 189, 248, 0.16);
          border-color: rgba(56, 189, 248, 0.35);
          text-decoration: none;
        }
        .note-text { margin-top: 4px; font-size: 11.5px; color: var(--faint); }

        /* QA Scheduled Release Cadence Box (Task B) */
        .qa-release-cadence-box {
          background: rgba(0, 240, 255, 0.04);
          border: 1px solid rgba(0, 240, 255, 0.25);
          border-radius: 8px;
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-family: 'JetBrains Mono', monospace;
          transition: all 0.2s ease;
        }
        .qa-release-cadence-box.imminent {
          background: rgba(245, 158, 11, 0.08);
          border-color: rgba(245, 158, 11, 0.4);
          box-shadow: 0 0 12px rgba(245, 158, 11, 0.15);
        }
        .qa-release-cadence-box.open {
          background: rgba(0, 255, 157, 0.08);
          border-color: rgba(0, 255, 157, 0.4);
          box-shadow: 0 0 16px rgba(0, 255, 157, 0.2);
        }
        .cadence-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .cadence-title-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .cadence-pulse-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
        }
        .cadence-pulse-dot.cyan { background: #00F0FF; box-shadow: 0 0 6px #00F0FF; }
        .cadence-pulse-dot.yellow { background: #F59E0B; box-shadow: 0 0 8px #F59E0B; animation: pulse 1.2s infinite; }
        .cadence-pulse-dot.green { background: #00FF9D; box-shadow: 0 0 10px #00FF9D; animation: pulse 1s infinite; }
        .cadence-badge-title {
          font-size: 9.5px;
          font-weight: 700;
          color: var(--muted);
          letter-spacing: 0.05em;
        }
        .cadence-pill {
          font-size: 9px;
          font-weight: 700;
          padding: 1px 6px;
          border-radius: 3px;
          background: rgba(0, 240, 255, 0.12);
          color: #00F0FF;
          border: 1px solid rgba(0, 240, 255, 0.3);
        }
        .cadence-pill.imminent {
          background: rgba(245, 158, 11, 0.15);
          color: #F59E0B;
          border-color: rgba(245, 158, 11, 0.4);
        }
        .cadence-pill.open {
          background: rgba(0, 255, 157, 0.15);
          color: #00FF9D;
          border-color: rgba(0, 255, 157, 0.4);
        }
        .cadence-time-row {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 6px;
        }
        .cadence-timer-val {
          font-size: 15px;
          font-weight: 800;
          color: #00F0FF;
          letter-spacing: -0.01em;
        }
        .qa-release-cadence-box.imminent .cadence-timer-val { color: #F59E0B; }
        .qa-release-cadence-box.open .cadence-timer-val { color: #00FF9D; }
        .cadence-rule-pill {
          font-size: 8.5px;
          font-weight: 700;
          color: #FB7185;
          background: rgba(244, 63, 94, 0.1);
          border: 1px solid rgba(244, 63, 94, 0.25);
          padding: 1px 5px;
          border-radius: 3px;
          letter-spacing: 0.02em;
        }
        .cadence-footer-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 10px;
          padding-top: 4px;
          border-top: 1px solid rgba(255, 255, 255, 0.05);
        }
        .cadence-slots {
          display: flex;
          align-items: center;
          gap: 5px;
          color: var(--faint);
        }
        .cadence-slot.active {
          color: var(--text);
          font-weight: 700;
        }
        .slot-dot { color: var(--border); font-size: 8px; }
        .cadence-lead-tag {
          color: var(--muted);
          font-size: 9.5px;
          font-weight: 600;
        }

        /* User Avatar Badges (Task E) */
        .user-avatar-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11.5px;
          color: var(--text);
          vertical-align: middle;
        }
        .user-avatar-img {
          border-radius: 50%;
          object-fit: cover;
          border: 1px solid rgba(0, 240, 255, 0.3);
          box-shadow: 0 0 6px rgba(0, 240, 255, 0.15);
        }
        .user-avatar-initials {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          background: linear-gradient(135deg, rgba(0, 240, 255, 0.2), rgba(192, 132, 252, 0.2));
          color: #00F0FF;
          font-weight: 700;
          border: 1px solid rgba(0, 240, 255, 0.3);
          flex-shrink: 0;
        }
        .user-avatar-text {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 140px;
        }

        /* Ticket & PR Links (Task E) */
        .ticket-link-cluster {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
          align-items: center;
        }
        .pr-deep-link {
          color: #C084FC;
          text-decoration: none;
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          font-weight: 700;
          display: inline-flex;
          align-items: center;
          gap: 3px;
          padding: 2px 6px;
          background: rgba(192, 132, 252, 0.1);
          border: 1px solid rgba(192, 132, 252, 0.3);
          border-radius: 4px;
          transition: all 0.15s;
        }
        .pr-deep-link:hover {
          background: rgba(192, 132, 252, 0.22);
          border-color: rgba(192, 132, 252, 0.5);
          box-shadow: 0 0 8px rgba(192, 132, 252, 0.3);
          color: #F3E8FF;
          text-decoration: none;
        }
        .inline-pr-link {
          color: #C084FC;
          font-weight: 700;
          text-decoration: underline;
          text-underline-offset: 2px;
          margin: 0 2px;
        }
        .inline-pr-link:hover {
          color: #E9D5FF;
          text-shadow: 0 0 8px rgba(192, 132, 252, 0.4);
        }

        .overlay {
          display: none;
          position: fixed;
          inset: 0;
          background: rgba(3, 5, 8, 0.85);
          backdrop-filter: blur(6px);
          z-index: 50;
          align-items: flex-start;
          justify-content: center;
          overflow-y: auto;
          padding: 40px 16px;
        }
        .wrap.light ~ .overlay { background: rgba(0,0,0,0.4); }
        .overlay.open { display: flex; }
        .modal {
          background: var(--panel);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 12px;
          width: 100%;
          max-width: 580px;
          padding: 26px;
          box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
        }
        .modal h2 {
          font-family: 'Space Grotesk', sans-serif;
          margin: 0 0 18px;
          font-size: 18px;
          font-weight: 700;
          letter-spacing: 0.02em;
          color: var(--text);
        }
        .field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .field { display: flex; flex-direction: column; gap: 6px; }
        .field.full { grid-column: 1/-1; }
        .field label {
          font-size: 11px;
          color: var(--muted);
          font-weight: 700;
          font-family: 'JetBrains Mono', monospace;
          letter-spacing: 0.03em;
        }
        .field select, .field input, .field textarea { width: 100%; }
        .field textarea { resize: vertical; min-height: 56px; }
        .modal-footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
        .req-star { color: var(--bad); }

        footer.note {
          margin-top: 32px;
          color: var(--faint);
          font-size: 11px;
          line-height: 1.6;
          text-align: center;
          font-family: 'JetBrains Mono', monospace;
        }

        :global(::-webkit-scrollbar) { height: 6px; width: 6px; }
        :global(::-webkit-scrollbar-thumb) { background: var(--border); border-radius: 3px; }
      `}</style>
    </>
  );
}
