import ApprovedEmailsPage from '@/components/lead-ingestion/ApprovedEmailsPage';

export const metadata = {
  title: 'Approved Unsent Emails Pool - Lead Automation',
  description: 'Filter, select, and bundle approved cold outreach emails into campaigns.',
};

export default function Page() {
  return <ApprovedEmailsPage />;
}
