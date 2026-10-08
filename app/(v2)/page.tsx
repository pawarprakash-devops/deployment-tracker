'use client';
import Link from 'next/link';
import ReleaseEnvs from './ReleaseEnvs';
import ReleaseHistory from './ReleaseHistory';
import ReleaseRadar from './ReleaseRadar';

// Landing page of vidai-deployments.vercel.app: environment status first, then what is waiting
// to ship, then the deployment history. Admin edit/import controls stay on /classic.
export default function ReleasesPage() {
  return (
    <>
      <div className="page-h" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1>Deployments</h1>
          <p>What is running where, what is waiting to ship, and what just changed.</p>
        </div>
        <Link href="/classic" className="legacy">Classic view (admin tools) →</Link>
      </div>
      <div className="stack" style={{ marginTop: 0 }}>
        <section className="card" aria-label="Environments"><ReleaseEnvs /></section>
        <ReleaseRadar />
        <section className="card" aria-label="Deployment history"><ReleaseHistory /></section>
      </div>
    </>
  );
}
