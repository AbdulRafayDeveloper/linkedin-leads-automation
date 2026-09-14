'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Sidebar from '@/components/sidebar/Sidebar';
import AppFooter from './AppFooter';
import AppHeader from './AppHeader';

export default function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen]);

  return (
    <div className="flex min-h-screen">
      <Sidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader onOpenMenu={() => setMobileOpen(true)} />
        <main className="min-w-0 flex-1 bg-white">{children}</main>
        <AppFooter />
      </div>
    </div>
  );
}
