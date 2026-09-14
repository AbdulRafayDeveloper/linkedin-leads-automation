import { Suspense } from 'react';
import CampaignsDashboardPage from '@/components/lead-ingestion/CampaignsDashboardPage';
import { LoaderIcon } from '@/components/ui/Icons';
import { pageMetadata } from '@/lib/seo/metadata';

export const metadata = pageMetadata({
  title: 'Campaigns',
  description:
    'Send approved cold emails as campaigns, one at a time with random delays, and track deliveries, failures and opens.',
  path: '/lead-ingestion/campaigns',
});

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <LoaderIcon width={28} height={28} className="text-indigo-600 animate-spin" />
          <span className="text-sm font-semibold text-slate-500">Loading Cold Email Campaigns...</span>
        </div>
      }
    >
      <CampaignsDashboardPage />
    </Suspense>
  );
}
