import type { ReactNode } from 'react';
import { pageMetadata } from '@/lib/seo/metadata';

// The page is a client component, so its metadata lives here.
export const metadata = pageMetadata({
  title: 'Leads',
  description:
    'Every imported prospect with their current companies, contact emails and SMTP verification status. Search, filter and open any lead.',
  path: '/my-leads',
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
