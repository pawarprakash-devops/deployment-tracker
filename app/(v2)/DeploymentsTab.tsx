'use client';
import ReleaseAdmin from './ReleaseAdmin';
import ReleaseCompare from './ReleaseCompare';
import ReleaseEnvs from './ReleaseEnvs';
import ReleaseHistory from './ReleaseHistory';
import ReleaseRadar from './ReleaseRadar';
import ReleaseStatus from './ReleaseStatus';
import ReleaseStats from './ReleaseStats';

export default function DeploymentsTab() {
  return (
    <>
      <div className="tab-page-header">
        <div>
          <h1 className="tab-page-title">Deployments</h1>
          <p className="tab-page-subtitle">
            What is running where, what is waiting to ship, and what just changed.
          </p>
        </div>
        <ReleaseAdmin />
      </div>
      <div className="tab-page-stack">
        <ReleaseStatus />
        <ReleaseStats />
        <ReleaseEnvs />
        <ReleaseRadar />
        <ReleaseHistory />
      </div>
      <ReleaseCompare />
    </>
  );
}
