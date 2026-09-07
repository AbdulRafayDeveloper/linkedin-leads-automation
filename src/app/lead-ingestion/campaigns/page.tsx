'use client';

import { Suspense } from 'react';
import CampaignsDashboardPage from '@/components/lead-ingestion/CampaignsDashboardPage';
import { LoaderIcon } from '@/components/ui/Icons';

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
