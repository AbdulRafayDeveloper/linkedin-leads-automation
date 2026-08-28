'use client';

import { useState } from 'react';
import Link from 'next/link';
import { processLeadApi } from '@/lib/api/client';
import type { LeadRecord, ProcessingResult } from '@/lib/types/lead';

const STEPS = [
  'Parsing profile content',
  'Researching company',
  'Discovering email',
  'Validating email',
  'Generating personalized email',
  'Saving to database',
  'Awaiting approval',
];

export default function LeadProcessingPage() {
  const [content, setContent] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [result, setResult] = useState<{ result: ProcessingResult; lead: LeadRecord } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;

    setIsProcessing(true);
    setError(null);
    setResult(null);
    setCurrentStep(0);

    const interval = setInterval(() => {
      setCurrentStep((step) => Math.min(step + 1, STEPS.length - 2));
    }, 700);

    try {
      const response = await processLeadApi(content);
      setCurrentStep(STEPS.length - 1);
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process lead');
    } finally {
      clearInterval(interval);
      setIsProcessing(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-2 text-2xl font-semibold">Process New Lead</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Paste the full content of a Sales Navigator lead page below.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={12}
          placeholder="Paste Sales Navigator lead content here..."
          className="rounded-md border border-neutral-300 p-3 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="submit"
          disabled={isProcessing || !content.trim()}
          className="self-start rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        >
          {isProcessing ? 'Processing…' : 'Process Lead'}
        </button>
      </form>

      {isProcessing && (
        <ol className="mt-6 flex flex-col gap-2 text-sm">
          {STEPS.map((step, index) => (
            <li key={step} className="flex items-center gap-2">
              <span>{index < currentStep ? '✅' : index === currentStep ? '⏳' : '⬜'}</span>
              <span className={index <= currentStep ? 'font-medium' : 'text-neutral-400'}>{step}</span>
            </li>
          ))}
        </ol>
      )}

      {error && <p className="mt-6 text-sm text-red-600">{error}</p>}

      {result && (
        <div
          data-testid="processing-result"
          className="mt-8 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
        >
          <h2 className="mb-3 text-lg font-semibold">Processing Complete</h2>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-neutral-500">Name</dt>
            <dd>{result.result.lead.fullName}</dd>
            <dt className="text-neutral-500">Company</dt>
            <dd>{result.result.lead.currentCompany}</dd>
            <dt className="text-neutral-500">Email</dt>
            <dd>{result.result.emailDiscovery.email || 'Not found'}</dd>
            <dt className="text-neutral-500">Validation Status</dt>
            <dd>{result.result.validation.status}</dd>
            <dt className="text-neutral-500">Processing Time</dt>
            <dd>{(result.result.totalProcessingTimeMs / 1000).toFixed(1)}s</dd>
          </dl>
          <div className="mt-4 rounded-md bg-neutral-50 p-3 text-sm dark:bg-neutral-800/50">
            <p className="font-semibold">{result.result.generatedEmail.subject}</p>
            <p className="mt-1 whitespace-pre-wrap text-neutral-600 dark:text-neutral-300">
              {result.result.generatedEmail.body}
            </p>
          </div>
          <Link
            href="/dashboard"
            className="mt-4 inline-block text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            View in dashboard →
          </Link>
        </div>
      )}
    </div>
  );
}
