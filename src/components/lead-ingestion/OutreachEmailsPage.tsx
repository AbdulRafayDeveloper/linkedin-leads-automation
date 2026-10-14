'use client';

import { Suspense } from 'react';
import { LoaderIcon } from '@/components/ui/Icons';
import DraftsPage from './drafts/DraftsPage';

/**
 * /lead-ingestion/emails. The page itself lives in ./drafts: DraftsPage (list,
 * filters, pagination), DraftCard and DraftEditorModal. The Suspense boundary
 * is required because the filters are read from the URL.
 */
export default function OutreachEmailsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col items-center justify-center gap-3 py-20">
          <LoaderIcon width={28} height={28} className="animate-spin text-indigo-600" />
          <span className="text-sm font-medium text-slate-500">Loading drafts…</span>
        </div>
      }
    >
      <DraftsPage />
    </Suspense>
  );
}
