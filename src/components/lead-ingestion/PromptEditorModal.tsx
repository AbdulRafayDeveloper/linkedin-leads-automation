'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { XIcon } from '@/components/ui/Icons';
import type { PromptRecord } from '@/services/lead-ingestion/apiClient';

/**
 * Near full-screen editor for one prompt. Esc or Cancel closes (asking first
 * when there are unsaved changes); Ctrl/Cmd+S saves.
 */
export default function PromptEditorModal({
  prompt,
  onClose,
  onSave,
}: {
  prompt: PromptRecord;
  onClose: () => void;
  onSave: (promptText: string) => Promise<void>;
}) {
  const [text, setText] = useState(prompt.promptText);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dirty = text !== prompt.promptText;
  const titleId = `prompt-editor-${prompt.key}`;

  const requestClose = useCallback(() => {
    if (saving) return;
    if (dirty && !window.confirm('Discard your unsaved changes to this prompt?')) return;
    onClose();
  }, [dirty, onClose, saving]);

  const save = useCallback(async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the prompt');
    } finally {
      setSaving(false);
    }
  }, [dirty, onSave, saving, text]);

  useEffect(() => {
    textareaRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [requestClose, save]);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close editor"
        onClick={requestClose}
        className="animate-fade-in absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]"
      />

      <div className="animate-fade-in absolute inset-3 flex flex-col overflow-hidden rounded-xl bg-white shadow-2xl sm:inset-6 lg:inset-8">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id={titleId} className="text-base font-semibold text-slate-900">
                {prompt.title}
              </h2>
              <Badge tone="info">{prompt.stage}</Badge>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">{prompt.description}</p>
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close editor"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            <XIcon width={18} height={18} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col p-4 sm:p-5">
          <label htmlFor={`${titleId}-text`} className="sr-only">
            {prompt.title}
          </label>
          <textarea
            id={`${titleId}-text`}
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            placeholder={prompt.emptyBehavior}
            className="min-h-0 flex-1 resize-none rounded-lg border border-slate-300 bg-white p-4 font-mono text-sm leading-relaxed text-slate-800 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 focus:outline-none"
          />
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3">
          <p className="text-xs text-slate-500" aria-live="polite">
            {text.length.toLocaleString()} characters
            {!text.trim() && <span className="text-amber-700"> · {prompt.emptyBehavior}</span>}
            {dirty && <span className="font-medium text-slate-700"> · Unsaved changes</span>}
            {error && <span className="font-medium text-red-600"> · {error}</span>}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setText(prompt.defaultText)}
              disabled={saving || text === prompt.defaultText}
            >
              Reset to default
            </Button>
            <Button variant="outline" size="sm" onClick={requestClose} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={!dirty} isLoading={saving}>
              Save prompt
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
