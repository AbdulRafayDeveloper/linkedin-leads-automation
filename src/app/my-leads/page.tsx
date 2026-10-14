import { Suspense } from 'react';
import MyLeadsPage from '@/components/my-leads/MyLeadsPage';
import { LoaderIcon } from '@/components/ui/Icons';
import { pageMetadata } from '@/lib/seo/metadata';

export const metadata = pageMetadata({
  title: 'Leads',
  description:
    'Every imported prospect with their current companies, contact emails and SMTP verification status. Search, filter and open any lead.',
  path: '/my-leads',
});

export default function Page() {
  // MyLeadsPage keeps its filters in the URL (useSearchParams).
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center gap-2 py-20 text-sm text-slate-500">
          <LoaderIcon width={18} height={18} className="animate-spin text-indigo-600" />
          Loading leads…
        </div>
      }
    >
      <MyLeadsPage />
    </Suspense>
  );
}
