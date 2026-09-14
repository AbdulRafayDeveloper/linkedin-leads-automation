'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import Button, { buttonClasses } from '@/components/ui/Button';
import StatusScreen from '@/components/layout/StatusScreen';
import { APP_HOME_PATH } from '@/lib/config/site';

// Shown inside the app shell when a page throws.
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <StatusScreen
      code="Error"
      title="Something went wrong"
      description={
        <>
          This page failed to load. Try again, or go back to the dashboard.
          {error.digest && <span className="mt-2 block font-mono text-xs text-slate-400">Ref: {error.digest}</span>}
        </>
      }
      actions={
        <>
          <Button onClick={() => retry()}>Try again</Button>
          <Link href={APP_HOME_PATH} className={buttonClasses('outline')}>
            Go to dashboard
          </Link>
        </>
      }
    />
  );
}
