import PromptSettingsPage from '@/components/lead-ingestion/PromptSettingsPage';
import { pageMetadata } from '@/lib/seo/metadata';

export const metadata = pageMetadata({
  title: 'AI Settings',
  description:
    'Edit the prompts every email goes through: the writing prompt (who you are, your pitch, tone and sign-off) and the format check prompt.',
  path: '/lead-ingestion/prompt',
});

export default function Page() {
  return <PromptSettingsPage />;
}
