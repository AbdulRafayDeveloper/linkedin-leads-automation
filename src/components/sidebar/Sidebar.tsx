'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils/cn';
import { XIcon } from '@/components/ui/Icons';
import Brand from './Brand';
import { NAV_SECTIONS, SETTINGS_ITEM, getActiveNav, type NavItem } from './navigation';

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors duration-150',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400',
        active ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'
      )}
    >
      {active && (
        <span className="absolute top-1/2 -left-3 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-indigo-400" />
      )}
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-md ring-1 transition-colors duration-150 ring-inset',
          active
            ? 'bg-indigo-500/15 text-indigo-300 ring-indigo-400/25'
            : 'bg-white/[0.03] text-slate-400 ring-white/[0.06] group-hover:text-slate-200'
        )}
      >
        <Icon width={16} height={16} />
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            'block truncate text-[13px] leading-5 font-medium',
            active ? 'text-white' : 'text-slate-300 group-hover:text-white'
          )}
        >
          {item.label}
        </span>
        <span
          className={cn(
            'block truncate text-[11.5px] leading-4',
            active ? 'text-slate-400' : 'text-slate-500'
          )}
        >
          {item.description}
        </span>
      </span>
    </Link>
  );
}

function SidebarContent({
  pathname,
  onNavigate,
  onClose,
}: {
  pathname: string;
  onNavigate?: () => void;
  onClose?: () => void;
}) {
  const activeHref = getActiveNav(pathname)?.item.href;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.06] px-4">
        <Brand />
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            <XIcon width={16} height={16} />
          </button>
        )}
      </div>

      <nav aria-label="Main" className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label}>
            <p className="px-2.5 pb-2 text-[11px] font-semibold tracking-[0.08em] text-slate-500 uppercase">
              {section.label}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  active={item.href === activeHref}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-white/[0.06] px-3 py-3">
        <NavLink
          item={SETTINGS_ITEM}
          active={SETTINGS_ITEM.href === activeHref}
          onNavigate={onNavigate}
        />
      </div>
    </div>
  );
}

export default function Sidebar({
  mobileOpen = false,
  onMobileClose,
}: {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}) {
  const pathname = usePathname();

  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 bg-slate-950 md:block">
        <SidebarContent pathname={pathname} />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            aria-label="Dismiss navigation"
            onClick={onMobileClose}
            className="animate-fade-in absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]"
          />
          <div className="animate-slide-in relative h-full w-72 max-w-[85%] bg-slate-950 shadow-2xl">
            <SidebarContent pathname={pathname} onNavigate={onMobileClose} onClose={onMobileClose} />
          </div>
        </div>
      )}
    </>
  );
}
