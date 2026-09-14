'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import {
  LoaderIcon,
  CheckCircleIcon,
  SparklesIcon,
  AlertTriangleIcon,
} from '@/components/ui/Icons';

export default function PromptSettingsPage() {
  const [promptText, setPromptText] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    async function fetchPromptSetting() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/settings/prompt');
        if (!res.ok) throw new Error('Failed to load global prompt settings');
        const data = (await res.json()) as { setting?: { promptText?: string } };

        if (data.setting) {
          setPromptText(data.setting.promptText ?? '');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error loading settings');
      } finally {
        setLoading(false);
      }
    }

    void fetchPromptSetting();
  }, []);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch('/api/settings/prompt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promptText }),
      });

      if (!res.ok) throw new Error('Failed to update prompt settings');
      setSuccessMsg('Global AI prompt saved. Every email generated from now on will use it.');
      setTimeout(() => setSuccessMsg(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full max-w-none px-4 sm:px-8 py-8 space-y-6">
      <PageHeader
        title="AI Settings"
        description="The prompt used to write every generated email."
      />

      {error && (
        <div className="flex items-start gap-2.5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangleIcon width={16} height={16} className="shrink-0 mt-0.5 text-red-600" />
          <div className="flex-1 font-semibold">{error}</div>
        </div>
      )}

      {successMsg && (
        <div className="flex items-start gap-2.5 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          <CheckCircleIcon width={16} height={16} className="shrink-0 mt-0.5 text-green-600" />
          <div className="flex-1 font-semibold">{successMsg}</div>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <LoaderIcon width={28} height={28} className="text-indigo-600 animate-spin" />
          <span className="text-sm font-semibold text-slate-500">Loading AI prompt...</span>
        </div>
      ) : (
        <form onSubmit={(e) => { void handleSaveSettings(e); }} className="space-y-6">
          <Card className="border border-indigo-100 bg-gradient-to-br from-indigo-50/20 to-white shadow-sm">
            <CardHeader
              title="Custom Global Outreach Instructions"
              action={<SparklesIcon width={18} height={18} className="text-indigo-600" />}
            />
            <CardContent className="pt-2 space-y-4">
              <p className="text-xs text-slate-600 leading-relaxed">
                Write who you are, your positioning, value proposition, tone, call to action and how the email
                should be signed off (name, links, phone). This prompt is the only sender context the AI gets for
                every lead email.
              </p>

              <textarea
                rows={24}
                placeholder="e.g. I am Abdul Rafay, a Senior Full Stack AI Developer. Always highlight my 2-week MVP delivery guarantee, keep the email body under 90 words, invite the lead for a free 15-minute technical audit call, and sign off with my name, portfolio link and WhatsApp number."
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                className="w-full min-h-[60vh] resize-y text-sm font-mono font-medium text-slate-800 border border-slate-300 rounded-md p-4 focus:ring-2 focus:ring-indigo-500 focus:outline-none leading-relaxed bg-white"
              />

              <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-100">
                <span className="text-[11px] font-semibold text-slate-400">
                  {promptText.length.toLocaleString()} characters
                </span>
                <Button
                  type="submit"
                  disabled={saving}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-6 py-2.5 flex items-center gap-2 text-xs shadow-md"
                >
                  {saving ? (
                    <LoaderIcon width={14} height={14} className="animate-spin" />
                  ) : (
                    <CheckCircleIcon width={14} height={14} />
                  )}
                  Save Prompt
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      )}
    </div>
  );
}
