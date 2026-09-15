'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { AlertTriangleIcon, ArrowRightIcon, CheckCircleIcon, LoaderIcon } from '@/components/ui/Icons';
import { getPromptsApi, savePromptApi, type PromptRecord } from '@/services/lead-ingestion/apiClient';
import PromptEditorModal from './PromptEditorModal';

function PromptStatus({ prompt }: { prompt: PromptRecord }) {
  if (!prompt.promptText.trim()) return <Badge tone="warning">Off</Badge>;
  if (prompt.isDefault) return <Badge tone="neutral">Default</Badge>;
  return <Badge tone="success">Custom</Badge>;
}

function PromptCard({ prompt, onOpen }: { prompt: PromptRecord; onOpen: () => void }) {
  const saved = prompt.updatedAt
    ? ` · Saved ${new Date(prompt.updatedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}`
    : '';

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex h-full flex-col rounded-lg border border-slate-200 bg-white p-5 text-left shadow-sm transition-all duration-150 hover:border-indigo-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold tracking-wide text-indigo-600 uppercase">{prompt.stage}</span>
        <PromptStatus prompt={prompt} />
      </div>
      <h2 className="mt-2 text-base font-semibold text-slate-900">{prompt.title}</h2>
      <p className="mt-1 text-sm leading-relaxed text-slate-500">{prompt.description}</p>

      <pre className="mt-4 line-clamp-5 rounded-md bg-slate-50 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-slate-600 ring-1 ring-slate-100">
        {prompt.promptText.trim() || prompt.emptyBehavior}
      </pre>

      <div className="mt-auto flex items-center justify-between gap-3 pt-4 text-xs text-slate-500">
        <span>
          {prompt.promptText.length.toLocaleString()} characters{saved}
        </span>
        <span className="inline-flex items-center gap-1 font-medium text-indigo-600 group-hover:underline">
          Open editor
          <ArrowRightIcon width={14} height={14} />
        </span>
      </div>
    </button>
  );
}

export default function PromptSettingsPage() {
  const [prompts, setPrompts] = useState<PromptRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    getPromptsApi()
      .then(({ prompts: list }) => setPrompts(list))
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : 'Failed to load prompts'));
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const openPrompt = prompts?.find((prompt) => prompt.key === openKey) ?? null;

  const handleSave = async (promptText: string) => {
    if (!openPrompt) return;
    const { prompt } = await savePromptApi(openPrompt.key, promptText);
    setPrompts((prev) => prev?.map((item) => (item.key === prompt.key ? prompt : item)) ?? null);
    setOpenKey(null);
    setNotice(`${prompt.title} saved. New and regenerated emails use it from now on.`);
  };

  return (
    <div className="w-full max-w-none space-y-6 px-4 py-8 sm:px-8">
      <PageHeader
        title="AI Settings"
        description="Every email goes through these prompts in order: the first writes it, the second checks its format. Click a prompt to edit it."
      />

      {notice && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700"
        >
          <CheckCircleIcon width={16} height={16} className="mt-0.5 shrink-0 text-green-600" />
          <div className="flex-1 font-medium">{notice}</div>
        </div>
      )}

      {loadError ? (
        <div className="flex items-start gap-2.5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangleIcon width={16} height={16} className="mt-0.5 shrink-0 text-red-600" />
          <div className="flex-1 font-medium">{loadError}</div>
        </div>
      ) : !prompts ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16">
          <LoaderIcon width={28} height={28} className="animate-spin text-indigo-600" />
          <span className="text-sm font-medium text-slate-500">Loading prompts...</span>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {prompts.map((prompt) => (
            <PromptCard key={prompt.key} prompt={prompt} onOpen={() => setOpenKey(prompt.key)} />
          ))}
        </div>
      )}

      {openPrompt && (
        <PromptEditorModal
          key={openPrompt.key}
          prompt={openPrompt}
          onClose={() => setOpenKey(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
