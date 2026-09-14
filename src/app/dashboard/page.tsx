import { Suspense } from 'react';
import DashboardPage from '@/components/dashboard/DashboardPage';
import { pageMetadata } from '@/lib/seo/metadata';

export const metadata = pageMetadata({
  title: 'Dashboard',
  description:
    'Track prospecting and outreach performance: leads imported, verified emails, approved drafts, campaign sends and opens over time.',
  path: '/dashboard',
});

export default function Page() {
  // DashboardPage reads the date range from the URL (useSearchParams).
  return (
    <Suspense>
      <DashboardPage />
    </Suspense>
  );
}
