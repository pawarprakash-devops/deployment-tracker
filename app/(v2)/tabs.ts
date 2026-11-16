export const TABS = [
  { id: 'deployments', label: 'Deployments' },
  { id: 'insights', label: 'Insights' },
] as const;

export type TabId = (typeof TABS)[number]['id'];

export const isTab = (v: string | null | undefined): v is TabId => TABS.some((t) => t.id === v);

// `/?tab=insights` is the shareable URL of Insights; default is Deployments (/).
export const tabHref = (id: TabId) => (id === 'deployments' ? '/' : `/?tab=${id}`);
