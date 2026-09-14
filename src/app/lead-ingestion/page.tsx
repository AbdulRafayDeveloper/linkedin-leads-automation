import LeadIngestionPage from '@/components/lead-ingestion/LeadIngestionPage';
import { pageMetadata } from '@/lib/seo/metadata';

export const metadata = pageMetadata({
  title: 'New Lead',
  description:
    'Paste a LinkedIn or Sales Navigator profile. LeadForge extracts the person and their companies, finds and verifies contact emails and drafts personalized outreach.',
  path: '/lead-ingestion',
});

export default function Page() {
  return <LeadIngestionPage />;
}
