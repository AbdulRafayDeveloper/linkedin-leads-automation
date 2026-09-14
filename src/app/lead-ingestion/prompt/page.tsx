import PromptSettingsPage from '@/components/lead-ingestion/PromptSettingsPage';
import { pageMetadata } from '@/lib/seo/metadata';

export const metadata = pageMetadata({
  title: 'AI Settings',
  description:
    'Set the outreach prompt the AI uses to write every personalized email: who you are, your pitch, tone and sign-off.',
  path: '/lead-ingestion/prompt',
});

export default function Page() {
  return <PromptSettingsPage />;
}
