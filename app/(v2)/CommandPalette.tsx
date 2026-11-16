'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  Server,
  Layers,
  BarChart3,
  Moon,
  Sun,
  RefreshCw,
  Download,
  CheckCircle2,
  AlertTriangle,
  X,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { useShell } from './ctx';

interface PaletteItem {
  id: string;
  category: 'Navigation' | 'Filter by Environment' | 'Filter by Status' | 'Quick Actions';
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  onSelect: () => void;
}

export default function CommandPalette() {
  const {
    searchOpen,
    setSearchOpen,
    setEnvFilter,
    setStatusFilter,
    theme,
    toggleTheme,
    refresh,
  } = useShell();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery('');
      setSelectedIndex(0);
    }
  }, [searchOpen]);

  // Global keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(!searchOpen);
      }
      if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchOpen, setSearchOpen]);

  const items: PaletteItem[] = [
    // Navigation
    {
      id: 'nav-deployments',
      category: 'Navigation',
      title: 'Deployments Dashboard',
      subtitle: 'View environment fleet, radar and history',
      icon: <Layers size={16} className="text-accent" />,
      onSelect: () => router.push('/'),
    },
    {
      id: 'nav-insights',
      category: 'Navigation',
      title: 'Delivery Insights & DORA',
      subtitle: 'Velocity metrics, failure rates and recovery audit',
      icon: <BarChart3 size={16} className="text-accent" />,
      onSelect: () => router.push('/?tab=insights'),
    },
    // Filter Environments
    {
      id: 'env-prod-neotia',
      category: 'Filter by Environment',
      title: 'Production (Neotia/Babyjoy)',
      subtitle: 'Prod India cluster ap-south-1',
      icon: <Server size={16} />,
      onSelect: () => {
        router.push('/');
        setEnvFilter('Production (Neotia/Babyjoy)');
      },
    },
    {
      id: 'env-prod-ankura',
      category: 'Filter by Environment',
      title: 'Production (Ankura)',
      subtitle: 'Prod Ankura cluster ap-south-1',
      icon: <Server size={16} />,
      onSelect: () => {
        router.push('/');
        setEnvFilter('Production (Ankura)');
      },
    },
    {
      id: 'env-prod-usw',
      category: 'Filter by Environment',
      title: 'Production USW',
      subtitle: 'Prod US West us-west-1 (prod_citmer)',
      icon: <Server size={16} />,
      onSelect: () => {
        router.push('/');
        setEnvFilter('Production USW');
      },
    },
    {
      id: 'env-preprod-euc',
      category: 'Filter by Environment',
      title: 'Pre-Prod Egypt',
      subtitle: 'Frankfurt eu-central-1 (preprod_egypt)',
      icon: <Server size={16} />,
      onSelect: () => {
        router.push('/');
        setEnvFilter('Pre-Prod Egypt');
      },
    },
    {
      id: 'env-stage',
      category: 'Filter by Environment',
      title: 'Stage',
      subtitle: 'Staging environment ap-south-1',
      icon: <Server size={16} />,
      onSelect: () => {
        router.push('/');
        setEnvFilter('Stage');
      },
    },
    {
      id: 'env-qa',
      category: 'Filter by Environment',
      title: 'QA',
      subtitle: 'QA environment ap-south-1',
      icon: <Server size={16} />,
      onSelect: () => {
        router.push('/');
        setEnvFilter('QA');
      },
    },
    {
      id: 'env-preview',
      category: 'Filter by Environment',
      title: 'Preview',
      subtitle: 'Preview 99999 ap-south-1 (dev branch)',
      icon: <Server size={16} />,
      onSelect: () => {
        router.push('/');
        setEnvFilter('Preview');
      },
    },
    // Filter Status
    {
      id: 'status-failed',
      category: 'Filter by Status',
      title: 'Show Failed Deployments',
      subtitle: 'Filter history by failure states',
      icon: <AlertTriangle size={16} className="text-danger" />,
      onSelect: () => {
        router.push('/');
        setStatusFilter('Failed');
      },
    },
    {
      id: 'status-success',
      category: 'Filter by Status',
      title: 'Show Successful Deployments',
      subtitle: 'Filter history by success states',
      icon: <CheckCircle2 size={16} className="text-success" />,
      onSelect: () => {
        router.push('/');
        setStatusFilter('Success');
      },
    },
    // Quick Actions
    {
      id: 'action-refresh',
      category: 'Quick Actions',
      title: 'Refresh Data Now',
      subtitle: 'Fetch latest deployments and probe health',
      icon: <RefreshCw size={16} />,
      onSelect: () => refresh(),
    },
    {
      id: 'action-theme',
      category: 'Quick Actions',
      title: theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode',
      subtitle: 'Change interface color theme',
      icon: theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />,
      onSelect: () => toggleTheme(),
    },
    {
      id: 'action-export',
      category: 'Quick Actions',
      title: 'Export Deployments JSON',
      subtitle: 'Download complete deployment records as JSON',
      icon: <Download size={16} />,
      onSelect: () => {
        window.open('/api/deployments?limit=1000', '_blank');
      },
    },
  ];

  const filtered = items.filter((item) => {
    const q = query.toLowerCase().trim();
    if (!q) return true;
    return (
      item.title.toLowerCase().includes(q) ||
      item.subtitle?.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q)
    );
  });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filtered.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % Math.max(1, filtered.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        filtered[selectedIndex].onSelect();
        setSearchOpen(false);
      }
    }
  };

  if (!searchOpen) return null;

  return (
    <div className="palette-backdrop" onClick={() => setSearchOpen(false)}>
      <div className="palette-modal" onClick={(e) => e.stopPropagation()}>
        <div className="palette-search-row">
          <Search size={18} className="palette-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="palette-input"
            placeholder="Search deployments, environments, actions... (↑↓ to navigate, Enter to select)"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
          <button
            type="button"
            className="palette-close-btn"
            onClick={() => setSearchOpen(false)}
            aria-label="Close search"
          >
            <X size={16} />
          </button>
        </div>

        <div className="palette-list">
          {filtered.length === 0 ? (
            <div className="palette-empty">
              <Sparkles size={24} className="palette-empty-icon" />
              <p>No results found for &ldquo;{query}&rdquo;</p>
            </div>
          ) : (
            filtered.map((item, index) => (
              <div
                key={item.id}
                className={`palette-item ${index === selectedIndex ? 'is-selected' : ''}`}
                onClick={() => {
                  item.onSelect();
                  setSearchOpen(false);
                }}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <div className="palette-item-icon">{item.icon}</div>
                <div className="palette-item-details">
                  <div className="palette-item-title">{item.title}</div>
                  {item.subtitle && <div className="palette-item-subtitle">{item.subtitle}</div>}
                </div>
                <div className="palette-item-category">{item.category}</div>
                <ArrowRight size={14} className="palette-item-arrow" />
              </div>
            ))
          )}
        </div>

        <div className="palette-footer">
          <span>
            <kbd>ESC</kbd> to exit
          </span>
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> to navigate
          </span>
          <span>
            <kbd>↵</kbd> to select
          </span>
        </div>
      </div>
    </div>
  );
}
