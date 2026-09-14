import OutreachEmailsPage from '@/components/lead-ingestion/OutreachEmailsPage';
import { pageMetadata } from '@/lib/seo/metadata';

export const metadata = pageMetadata({
  title: 'Drafts',
  description:
    'Review, edit, refine with AI and approve the personalized cold emails written for every lead and company.',
  path: '/lead-ingestion/emails',
});

export default function Page() {
  return <OutreachEmailsPage />;
}
