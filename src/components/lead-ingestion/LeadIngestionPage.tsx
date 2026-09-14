'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { LoaderIcon, MailIcon, SparklesIcon, AlertTriangleIcon } from '@/components/ui/Icons';

export default function LeadIngestionPage() {
  const router = useRouter();
  const [rawText, setRawText] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  const handleIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = rawText.trim();
    if (!text) return;

    setPageError(null);
    setExtracting(true);

    try {
      // Execute Step 1 (AI Extraction) to create Client and LeadIngestion record
      const res = await fetch('/api/lead-ingestion/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase: 'extract', content: text }),
      });

      if (!res.ok || !res.body) {
        throw new Error('Failed to extract candidate data');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let leadId: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const chunks = buf.split('\n\n');
        buf = chunks.pop() ?? '';

        let streamError: string | null = null;

        for (const chunk of chunks) {
          const eventMatch = chunk.match(/^event:\s*(.+)/m);
          const dataMatch = chunk.match(/^data:\s*([\s\S]+)/m);
          if (!eventMatch || !dataMatch) continue;
          try {
            const event = eventMatch[1].trim();
            const data = JSON.parse(dataMatch[1].trim()) as Record<string, unknown>;
            if (event === 'client_created' && data.leadId) {
              leadId = data.leadId as string;
            }
            if (event === 'error' && data.message) {
              streamError = data.message as string;
            }
          } catch { /* ignore */ }
        }

        if (streamError) {
          throw new Error(streamError);
        }
      }

      if (leadId) {
        // Immediate redirect to dedicated candidate client profile page!
        router.push(`/lead-ingestion/client/${leadId}`);
      } else {
        throw new Error('Could not retrieve candidate record ID');
      }
    } catch (err) {
      setExtracting(false);
      setPageError(err instanceof Error ? err.message : 'Processing failed');
    }
  };

  return (
    <div className="w-full max-w-none px-4 sm:px-8 py-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeader
          title="New Lead"
          description="Paste a LinkedIn or Sales Navigator profile. Contacts are found, verified and drafted automatically."
        />
        <Link href="/lead-ingestion/emails">
          <Button variant="outline" className="flex items-center gap-2 border-indigo-200 text-indigo-700 hover:bg-indigo-50 text-sm">
            <MailIcon width={15} height={15} />
            View drafts
          </Button>
        </Link>
      </div>

      {pageError && (
        <div className="flex gap-2.5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangleIcon width={15} height={15} className="shrink-0 mt-0.5" />
          {pageError}
        </div>
      )}

      {/* Paste Box */}
      <Card className="border border-indigo-100 bg-gradient-to-br from-indigo-50/30 to-white shadow-sm">
        <CardHeader
          title="Paste LinkedIn Raw Profile Text"
          action={<SparklesIcon width={16} height={16} className="text-indigo-400" />}
        />
        <CardContent className="pt-2">
          <form onSubmit={(e) => { void handleIngest(e); }} className="space-y-4">
            <textarea
              rows={8}
              required
              placeholder="Paste the full raw text from a LinkedIn Sales Navigator profile page here..."
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              disabled={extracting}
              className="w-full text-sm text-slate-800 border border-slate-200 rounded-md p-4 focus:ring-2 focus:ring-indigo-500 focus:outline-none leading-relaxed bg-white disabled:opacity-50"
            />
            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={!rawText.trim() || extracting}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-8 py-3 flex items-center gap-2 text-sm shadow-md"
              >
                {extracting ? (
                  <>
                    <LoaderIcon width={16} height={16} className="animate-spin" />
                    Extracting Candidate & Redirecting...
                  </>
                ) : (
                  <>
                    <SparklesIcon width={16} height={16} />
                    Extract Candidate & Open Workspace
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
