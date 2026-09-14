import HomePage from '@/components/home/HomePage';
import { SITE_DESCRIPTION, SITE_TITLE } from '@/lib/config/site';
import { pageMetadata } from '@/lib/seo/metadata';

export const metadata = pageMetadata({
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  path: '/',
  absoluteTitle: true,
});

export default function Page() {
  return <HomePage />;
}
