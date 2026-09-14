import ApprovedEmailsPage from '@/components/lead-ingestion/ApprovedEmailsPage';
import { pageMetadata } from '@/lib/seo/metadata';

export const metadata = pageMetadata({
  title: 'Ready to Send',
  description:
    'Approved outreach emails that have not been sent yet. Pick drafts and group them into a cold email campaign.',
  path: '/lead-ingestion/approved',
});

export default function Page() {
  return <ApprovedEmailsPage />;
}
