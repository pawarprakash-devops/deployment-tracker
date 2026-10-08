export const TABS = [
  { id: 'deployments', label: 'Deployments' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'my-view', label: 'My view' },
  { id: 'tickets', label: 'Tickets' },
  { id: 'insights', label: 'Insights' },
  { id: 'health', label: 'Health' },
] as const;

export type TabId = (typeof TABS)[number]['id'];

export const isTab = (v: string | null | undefined): v is TabId => TABS.some((t) => t.id === v);

// `/?tab=insights` is the shareable URL of a tab; the default tab has a clean `/`.
export const tabHref = (id: TabId) => (id === 'deployments' ? '/' : `/?tab=${id}`);
