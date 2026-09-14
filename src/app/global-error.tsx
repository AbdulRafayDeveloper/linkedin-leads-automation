'use client';

import Button from '@/components/ui/Button';
import StatusScreen from '@/components/layout/StatusScreen';
import { APP_HOME_PATH, SITE_NAME } from '@/lib/config/site';
import './globals.css';

// Replaces the root layout when the layout itself fails, so it renders its own
// document. Metadata exports aren't supported here, hence the <title> tag.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-white">
        <title>{`Something went wrong · ${SITE_NAME}`}</title>
        <StatusScreen
          code="Error"
          title="Something went wrong"
          description={
            <>
              {SITE_NAME} couldn&apos;t load. Try again, or reload the dashboard.
              {error.digest && (
                <span className="mt-2 block font-mono text-xs text-slate-400">Ref: {error.digest}</span>
              )}
            </>
          }
          actions={
            <>
              <Button onClick={() => retry()}>Try again</Button>
              {/* A full page load, since the app shell itself failed. */}
              <a href={APP_HOME_PATH} className="text-sm font-medium text-slate-600 hover:text-slate-900">
                Reload dashboard
              </a>
            </>
          }
        />
      </body>
    </html>
  );
}
