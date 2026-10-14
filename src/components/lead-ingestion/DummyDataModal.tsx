'use client';

import { useCallback, useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  CopyIcon,
  EditIcon,
  LoaderIcon,
  PlusCircleIcon,
  SparklesIcon,
  TrashIcon,
} from '@/components/ui/Icons';
import { cn } from '@/lib/utils/cn';
import { MAX_PROFILE_CHARS } from '@/lib/validation/ingestionInput';
import {
  createSampleApi,
  deleteSampleApi,
  listSamplesApi,
  updateSampleApi,
  type SampleProfileRecord,
} from '@/services/sample-profiles/sampleProfilesApi';

const MAX_TITLE_CHARS = 120;

interface DummyDataModalProps {
  open: boolean;
  onClose: () => void;
  /** Puts the sample into the New Lead box and closes the dialog. */
  onUse: (content: string) => void;
}

type View = { mode: 'list' } | { mode: 'new' } | { mode: 'edit'; sample: SampleProfileRecord };

// The pasted text starts with LinkedIn's own menu, which looks the same on
// every profile. The card preview skips it so each sample shows its person.
const CHROME_LINES = new Set([
  '0 notifications',
  "i'm looking for…",
  'home',
  'my network',
  'jobs',
  'messaging',
  'notifications',
  'me',
  'for business',
  'sales nav',
  'cover photo',
  '1',
]);

function previewOf(content: string, max = 420): string {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !CHROME_LINES.has(line.toLowerCase()));
  const text = lines.slice(0, 8).join('\n');
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers, or a page without clipboard permission.
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}

export default function DummyDataModal({ open, onClose, onUse }: DummyDataModalProps) {
  const [samples, setSamples] = useState<SampleProfileRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ mode: 'list' });
  const [draft, setDraft] = useState({ title: '', content: '' });
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SampleProfileRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSamples(await listSamplesApi());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the saved samples.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Opening is an external event, so the reset runs after paint rather than
  // synchronously inside the effect.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      setView({ mode: 'list' });
      setCopiedId(null);
      void load();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, load]);

  const startNew = () => {
    setDraft({ title: '', content: '' });
    setError(null);
    setView({ mode: 'new' });
  };

  const startEdit = (sample: SampleProfileRecord) => {
    setDraft({ title: sample.title, content: sample.content });
    setError(null);
    setView({ mode: 'edit', sample });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      if (view.mode === 'edit') {
        const updated = await updateSampleApi(view.sample.id, draft);
        setSamples((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      } else {
        const created = await createSampleApi(draft);
        setSamples((prev) => [...prev, created]);
      }
      setView({ mode: 'list' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that sample.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteSampleApi(pendingDelete.id);
      setSamples((prev) => prev.filter((s) => s.id !== pendingDelete.id));
      setPendingDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete that sample.');
    } finally {
      setDeleting(false);
    }
  };

  const handleCopy = async (sample: SampleProfileRecord) => {
    const ok = await copyToClipboard(sample.content);
    if (!ok) {
      setError('Copying failed. Open the sample with Edit and copy the text by hand.');
      return;
    }
    setCopiedId(sample.id);
    window.setTimeout(() => setCopiedId((id) => (id === sample.id ? null : id)), 2000);
  };

  const editing = view.mode !== 'list';
  const canSave = !!draft.title.trim() && !!draft.content.trim() && !saving;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="screen"
        title="Dummy data"
        subtitle={
          editing
            ? 'Give the sample a name and paste the profile text.'
            : 'Saved profile text for testing. Use one, copy it, or keep your own.'
        }
        headerExtra={
          !editing && !loading ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
              {samples.length} {samples.length === 1 ? 'sample' : 'samples'}
            </span>
          ) : null
        }
        footer={
          editing ? (
            <>
              <Button variant="outline" onClick={() => setView({ mode: 'list' })} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={() => void handleSave()} disabled={!canSave} isLoading={saving}>
                {view.mode === 'edit' ? 'Save changes' : 'Add sample'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={startNew}>
                <PlusCircleIcon width={15} height={15} />
                Add sample
              </Button>
              <Button variant="secondary" onClick={onClose}>
                Done
              </Button>
            </>
          )
        }
      >
        {error && (
          <div role="alert" className="mb-4 flex gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <AlertTriangleIcon width={16} height={16} className="mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1">{error}</span>
          </div>
        )}

        {editing ? (
          <div className="flex h-full min-h-0 flex-col gap-4">
            <div>
              <label htmlFor="sample-title" className="mb-1.5 block text-sm font-medium text-slate-700">
                Name
              </label>
              <input
                id="sample-title"
                value={draft.title}
                maxLength={MAX_TITLE_CHARS}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                placeholder="e.g. Mark Allen — DevOps Engineer"
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-500 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <label htmlFor="sample-content" className="mb-1.5 block text-sm font-medium text-slate-700">
                Profile text
              </label>
              <textarea
                id="sample-content"
                value={draft.content}
                maxLength={MAX_PROFILE_CHARS}
                spellCheck={false}
                onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
                placeholder="Paste the full profile text here…"
                className="min-h-[240px] w-full flex-1 resize-y rounded-md border border-slate-200 bg-white p-3 font-mono text-[12px] leading-relaxed text-slate-800 placeholder:text-slate-500 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
              <p className="mt-1.5 text-right text-xs text-slate-400 tabular-nums">
                {draft.content.length.toLocaleString('en-US')} / {MAX_PROFILE_CHARS.toLocaleString('en-US')}
              </p>
            </div>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
            <LoaderIcon width={16} height={16} className="animate-spin text-indigo-600" />
            Loading samples…
          </div>
        ) : samples.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-slate-600">No samples saved.</p>
            <p className="mt-1 text-xs text-slate-400">Add one, or close and reopen to restore the three starter samples.</p>
          </div>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {samples.map((sample) => (
              <li
                key={sample.id}
                className="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="min-w-0 text-sm font-semibold break-words text-slate-900">{sample.title}</h3>
                  <span className="shrink-0 rounded-full bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500 tabular-nums">
                    {sample.content.length.toLocaleString('en-US')} chars
                  </span>
                </div>

                <pre className="mt-2 max-h-40 flex-1 overflow-hidden rounded-md bg-slate-50 p-3 text-[11px] leading-5 whitespace-pre-wrap text-slate-600">
                  {previewOf(sample.content)}
                </pre>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={() => onUse(sample.content)} className="grow justify-center sm:grow-0">
                    <SparklesIcon width={14} height={14} />
                    Use this
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleCopy(sample)}
                    className={cn('grow justify-center sm:grow-0', copiedId === sample.id && 'border-emerald-300 text-emerald-700')}
                  >
                    {copiedId === sample.id ? (
                      <>
                        <CheckCircleIcon width={14} height={14} />
                        Copied
                      </>
                    ) : (
                      <>
                        <CopyIcon width={14} height={14} />
                        Copy
                      </>
                    )}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => startEdit(sample)} aria-label={`Edit ${sample.title}`}>
                    <EditIcon width={14} height={14} />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setPendingDelete(sample)}
                    aria-label={`Delete ${sample.title}`}
                    className="text-red-600 hover:bg-red-50 hover:text-red-700"
                  >
                    <TrashIcon width={14} height={14} />
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <ConfirmDialog
        open={!!pendingDelete}
        tone="danger"
        title="Delete this sample?"
        description={pendingDelete ? `"${pendingDelete.title}" will be removed.` : undefined}
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}
