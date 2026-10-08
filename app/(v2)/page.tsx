'use client';
import { useSearchParams } from 'next/navigation';
import DeploymentsTab from './DeploymentsTab';
import HealthTab from './HealthTab';
import InsightsTab from './InsightsTab';
import MyViewTab from './MyViewTab';
import PipelineTab from './PipelineTab';
import TicketsTab from './TicketsTab';
import { isTab } from './tabs';

// One page, six tabs: /?tab=<id>. The default (no param) is Deployments, which is what
// vidai-deployments.vercel.app opens on. Old URLs (/jira, /admin, /health, /classic, /home,
// /pipeline) redirect here via next.config.ts.
export default function Page() {
  const raw = useSearchParams().get('tab');
  const tab = isTab(raw) ? raw : 'deployments';
  return (
    <>
      {tab === 'deployments' && <DeploymentsTab />}
      {tab === 'pipeline' && <PipelineTab />}
      {tab === 'my-view' && <MyViewTab />}
      {tab === 'tickets' && <TicketsTab />}
      {tab === 'insights' && <InsightsTab />}
      {tab === 'health' && <HealthTab />}
    </>
  );
}
