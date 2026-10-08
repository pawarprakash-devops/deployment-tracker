'use client';
import { useShell } from '../ctx';
import DevLens from '../DevLens';
import QaLens from '../QaLens';
import RelLens from '../RelLens';
import MgmtLens from '../MgmtLens';

export default function HomePage() {
  const { lens } = useShell();
  return (
    <>
      {lens === 'dev' && <DevLens />}
      {lens === 'qa' && <QaLens />}
      {lens === 'rel' && <RelLens />}
      {lens === 'mgmt' && <MgmtLens />}
    </>
  );
}
