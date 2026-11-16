'use client';
import { useSearchParams } from 'next/navigation';
import DeploymentsTab from './DeploymentsTab';
import InsightsTab from './InsightsTab';
import { isTab } from './tabs';

export default function Page() {
  const raw = useSearchParams().get('tab');
  const tab = isTab(raw) ? raw : 'deployments';
  return (
    <>
      {tab === 'deployments' && <DeploymentsTab />}
      {tab === 'insights' && <InsightsTab />}
    </>
  );
}
