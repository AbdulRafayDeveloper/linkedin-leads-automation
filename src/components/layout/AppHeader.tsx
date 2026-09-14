'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRightIcon, MenuIcon, PlusCircleIcon } from '@/components/ui/Icons';
import { BrandMark } from '@/components/sidebar/Brand';
import { getActiveNav } from '@/components/sidebar/navigation';
import { APP_HOME_PATH, SITE_NAME } from '@/lib/config/site';

function Separator() {
  return <ChevronRightIcon width={14} height={14} className="shrink-0 text-slate-300" />;
}

export default function AppHeader({ onOpenMenu }: { onOpenMenu: () => void }) {
  const pathname = usePathname();
  const active = getActiveNav(pathname);
  const onNewLead = active?.item.href === '/lead-ingestion';

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-slate-200/80 bg-white/80 px-4 backdrop-blur-md sm:px-6">
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Open navigation"
        className="-ml-1 inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 md:hidden"
      >
        <MenuIcon width={18} height={18} />
      </button>
      <Link href={APP_HOME_PATH} aria-label={`${SITE_NAME} home`} className="rounded-md md:hidden">
        <BrandMark size={28} />
      </Link>

      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px]">
        {active ? (
          <>
            <span className="hidden text-slate-400 sm:inline">{active.section}</span>
            <span className="hidden sm:inline">
              <Separator />
            </span>
            {active.isDetail ? (
              <>
                <Link
                  href={active.item.href}
                  className="truncate text-slate-500 transition-colors hover:text-slate-900"
                >
                  {active.item.label}
                </Link>
                <Separator />
                <span className="truncate font-medium text-slate-900">
                  {active.item.detailLabel ?? 'Details'}
                </span>
              </>
            ) : (
              <span className="truncate font-medium text-slate-900">{active.item.label}</span>
            )}
          </>
        ) : (
          <span className="font-medium text-slate-900">{SITE_NAME}</span>
        )}
      </nav>

      {!onNewLead && (
        <Link
          href="/lead-ingestion"
          className="ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          <PlusCircleIcon width={15} height={15} />
          New lead
        </Link>
      )}
    </header>
  );
}
