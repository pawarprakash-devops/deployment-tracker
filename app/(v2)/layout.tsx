import type { Metadata } from 'next';
import { Suspense } from 'react';
import './tokens.css';
import './shell.css';
import AppShell from './AppShell';
import ClientOnly from './ClientOnly';
import { ShellProvider } from './ctx';

export const metadata: Metadata = {
  title: 'VidAI Delivery — Fleet & Deployment Tracker',
  description: 'Enterprise deployment tracking, fleet health monitoring, promotion radar and DORA metrics',
};

export default function V2Layout({ children }: { children: React.ReactNode }) {
  return (
    <ShellProvider>
      <ClientOnly>
        <Suspense fallback={null}>
          <AppShell>{children}</AppShell>
        </Suspense>
      </ClientOnly>
    </ShellProvider>
  );
}
