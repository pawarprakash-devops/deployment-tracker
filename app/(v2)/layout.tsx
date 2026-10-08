import type { Metadata } from 'next';
import { Suspense } from 'react';
import './tokens.css';
import './shell.css';
import AppShell from './AppShell';
import ClientOnly from './ClientOnly';
import { ShellProvider } from './ctx';

export const metadata: Metadata = {
  title: 'VidAI Delivery',
  description: 'Role-based deployment and ticket tracker',
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
