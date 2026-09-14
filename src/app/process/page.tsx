import LeadProcessingPage from '@/components/process/LeadProcessingPage';
import { pageMetadata } from '@/lib/seo/metadata';

export const metadata = pageMetadata({
  title: 'Process Lead',
  description:
    'Research a Sales Navigator lead: find the company website, discover and validate emails and generate a personalized email.',
  path: '/process',
});

export default function ProcessPage() {
  return <LeadProcessingPage />;
}
