'use client';

import { useState } from 'react';
import Link from 'next/link';
import { processLeadApi } from '@/lib/api/client';
import type { LeadRecord, ProcessingResult } from '@/lib/types/lead';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Input';
import Button, { buttonClasses } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import { AlertTriangleIcon, ArrowRightIcon, CheckCircleIcon, LoaderIcon } from '@/components/ui/Icons';
import { cn } from '@/lib/utils/cn';

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
    <div className="mx-auto max-w-3xl px-6 py-8">
      <PageHeader
        title="Process New Lead"
        description="Paste the full content of a Sales Navigator lead page below."
      />

      <Card>
        <CardContent className="pt-5">
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={12}
              placeholder="Paste Sales Navigator lead content here..."
              className="font-mono text-xs leading-relaxed"
            />
            <Button type="submit" size="md" className="self-start" disabled={!content.trim()} isLoading={isProcessing}>
              {isProcessing ? 'Processing…' : 'Process Lead'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {isProcessing && (
        <Card className="mt-4">
          <CardContent className="py-4">
            <ol className="flex flex-col gap-3 text-sm">
              {STEPS.map((step, index) => {
                const done = index < currentStep;
                const active = index === currentStep;
                return (
                  <li key={step} className="flex items-center gap-2.5">
                    {done ? (
                      <CheckCircleIcon width={16} height={16} className="shrink-0 text-emerald-600" />
                    ) : active ? (
                      <LoaderIcon width={16} height={16} className="shrink-0 text-indigo-600" />
                    ) : (
                      <span className="h-4 w-4 shrink-0 rounded-full border-2 border-slate-200" />
                    )}
                    <span className={cn(done || active ? 'font-medium text-slate-800' : 'text-slate-400')}>
                      {step}
                    </span>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      )}

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangleIcon width={16} height={16} />
          {error}
        </div>
      )}

      {result && (
        <Card data-testid="processing-result" className="mt-6">
          <CardHeader
            title="Processing Complete"
            action={<StatusBadge value={result.result.validation.status} />}
          />
          <CardContent>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-slate-500">Name</dt>
              <dd className="text-slate-800">{result.result.lead.fullName}</dd>
              <dt className="text-slate-500">Company</dt>
              <dd className="text-slate-800">{result.result.lead.currentCompany}</dd>
              <dt className="text-slate-500">Email</dt>
              <dd className="text-slate-800">{result.result.emailDiscovery.email || 'Not found'}</dd>
              <dt className="text-slate-500">Processing Time</dt>
              <dd className="text-slate-800">{(result.result.totalProcessingTimeMs / 1000).toFixed(1)}s</dd>
            </dl>
            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="font-semibold text-slate-900">{result.result.generatedEmail.subject}</p>
              <p className="mt-1 whitespace-pre-wrap text-slate-600">{result.result.generatedEmail.body}</p>
            </div>
            <Link
              href="/dashboard"
              className={cn(buttonClasses('outline', 'sm'), 'mt-4')}
            >
              View in dashboard
              <ArrowRightIcon width={14} height={14} />
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
