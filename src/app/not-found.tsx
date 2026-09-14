import Link from 'next/link';
import { buttonClasses } from '@/components/ui/buttonClasses';
import StatusScreen from '@/components/layout/StatusScreen';
import { APP_HOME_PATH } from '@/lib/config/site';

export const metadata = { title: 'Page not found' };

export default function NotFound() {
  return (
    <StatusScreen
      code="404"
      title="Page not found"
      description="This page doesn't exist or was moved. The lead or campaign you were looking for may have been deleted."
      actions={
        <>
          <Link href={APP_HOME_PATH} className={buttonClasses('primary')}>
            Go to dashboard
          </Link>
          <Link href="/my-leads" className={buttonClasses('outline')}>
            View leads
          </Link>
        </>
      }
    />
  );
}
