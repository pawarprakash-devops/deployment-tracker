'use client';
import ReleaseAdmin from './ReleaseAdmin';
import ReleaseCompare from './ReleaseCompare';
import ReleaseEnvs from './ReleaseEnvs';
import ReleaseHistory from './ReleaseHistory';
import ReleaseRadar from './ReleaseRadar';
import ReleaseStats from './ReleaseStats';

// Landing page of vidai-deployments.vercel.app: environment status first, then what is waiting
// to ship, then the full deployment history. Sections talk through window events
// (tracker:data-changed, tracker:refresh, tracker:compare, tracker:edit-deployment,
// tracker:delete-deployment, tracker:auth-changed) so each one stays a standalone component.
export default function ReleasesPage() {
  return (
    <>
      <div className="page-h" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1>Deployments</h1>
          <p>What is running where, what is waiting to ship, and what just changed.</p>
        </div>
        <ReleaseAdmin />
      </div>
      <div className="stack" style={{ marginTop: 0 }}>
        <ReleaseStats />
        <ReleaseEnvs />
        <ReleaseRadar />
        <ReleaseHistory />
      </div>
      <ReleaseCompare />
    </>
  );
}
