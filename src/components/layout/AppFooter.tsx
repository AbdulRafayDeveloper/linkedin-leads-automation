import Link from 'next/link';
import { BrandMark } from '@/components/sidebar/Brand';
import { APP_HOME_PATH, SITE_NAME, SITE_TAGLINE } from '@/lib/config/site';

export default function AppFooter() {
  return (
    <footer className="border-t border-slate-200/80 bg-white px-4 py-4 sm:px-6">
      <div className="flex flex-col gap-2 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
        <Link
          href={APP_HOME_PATH}
          className="flex w-fit items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        >
          <BrandMark size={20} />
          <span className="font-semibold tracking-tight text-slate-700">{SITE_NAME}</span>
          <span className="hidden text-slate-400 sm:inline">{SITE_TAGLINE}</span>
        </Link>
        <p>
          © {new Date().getFullYear()} {SITE_NAME}
        </p>
      </div>
    </footer>
  );
}
