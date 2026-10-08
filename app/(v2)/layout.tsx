import type { Metadata } from 'next';
import './tokens.css';
import './shell.css';
import AppShell from './AppShell';
import { ShellProvider } from './ctx';

export const metadata: Metadata = {
  title: 'VidAI Delivery',
  description: 'Role-based deployment and ticket tracker',
};

export default function V2Layout({ children }: { children: React.ReactNode }) {
  return (
    <ShellProvider>
      <AppShell>{children}</AppShell>
    </ShellProvider>
  );
}
