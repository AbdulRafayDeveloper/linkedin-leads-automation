'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: '🏠' },
  { href: '/process', label: 'Process New Lead', icon: '➕' },
  { href: '/dashboard', label: 'My Leads', icon: '📋' },
];

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1">
      {NAV_ITEMS.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              isActive
                ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
                : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
            }`}
            aria-current={isActive ? 'page' : undefined}
          >
            <span aria-hidden="true">{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <div className="flex items-center justify-between border-b border-neutral-200 p-4 md:hidden dark:border-neutral-800">
        <span className="text-lg font-semibold">Lead Engine</span>
        <button
          type="button"
          onClick={() => setMobileOpen((open) => !open)}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700"
          aria-label="Toggle navigation menu"
        >
          {mobileOpen ? 'Close' : 'Menu'}
        </button>
      </div>

      {mobileOpen && (
        <div className="border-b border-neutral-200 p-4 md:hidden dark:border-neutral-800">
          <NavLinks pathname={pathname} onNavigate={() => setMobileOpen(false)} />
        </div>
      )}

      <aside className="hidden w-64 shrink-0 border-r border-neutral-200 p-4 md:block dark:border-neutral-800">
        <div className="mb-6 text-lg font-semibold">Lead Engine</div>
        <NavLinks pathname={pathname} />
      </aside>
    </>
  );
}
