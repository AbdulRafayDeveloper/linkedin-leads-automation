'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/utils/cn';
import { HomeIcon, MenuIcon, PlusCircleIcon, UsersIcon, XIcon } from '@/components/ui/Icons';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: HomeIcon },
  { href: '/process', label: 'Process New Lead', icon: PlusCircleIcon },
  { href: '/lead-ingestion', label: 'Client Ingestion', icon: PlusCircleIcon },
  { href: '/dashboard', label: 'My Leads', icon: UsersIcon },
];

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
        L
      </div>
      <div className="leading-tight">
        <p className="text-sm font-semibold text-slate-900">Lead Engine</p>
        <p className="text-xs text-slate-400">Outreach intelligence</p>
      </div>
    </div>
  );
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1">
      <p className="px-3 pb-1.5 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
        Workspace
      </p>
      {NAV_ITEMS.map((item) => {
        const isActive = pathname === item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              'group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            )}
            aria-current={isActive ? 'page' : undefined}
          >
            {isActive && (
              <span className="absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-indigo-600" />
            )}
            <Icon
              className={isActive ? 'text-indigo-600' : 'text-slate-400 group-hover:text-slate-500'}
            />
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
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
        <Brand />
        <button
          type="button"
          onClick={() => setMobileOpen((open) => !open)}
          aria-expanded={mobileOpen}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
        >
          {mobileOpen ? <XIcon width={16} height={16} /> : <MenuIcon width={16} height={16} />}
          {mobileOpen ? 'Close' : 'Menu'}
        </button>
      </div>

      {mobileOpen && (
        <>
          <button
            type="button"
            aria-label="Dismiss navigation overlay"
            onClick={() => setMobileOpen(false)}
            className="fixed inset-0 z-40 bg-slate-900/30 md:hidden"
          />
          <div className="animate-fade-in fixed inset-x-0 top-[57px] z-50 border-b border-slate-200 bg-white p-4 shadow-lg md:hidden">
            <NavLinks pathname={pathname} onNavigate={() => setMobileOpen(false)} />
          </div>
        </>
      )}

      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-slate-50 md:flex">
        <div className="border-b border-slate-200 px-4 py-5">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <NavLinks pathname={pathname} />
        </div>
        <div className="border-t border-slate-200 px-4 py-3">
          <p className="text-xs text-slate-400">v0.1 &middot; MongoDB backed</p>
        </div>
      </aside>
    </>
  );
}
