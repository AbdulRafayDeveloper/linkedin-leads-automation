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
  const [senderName, setSenderName] = useState('Abdul Rafay');
  const [senderTitle, setSenderTitle] = useState('Senior Full Stack AI Developer');
  const [senderPositioning, setSenderPositioning] = useState('builds production web and AI applications|has shipped 70+ production-ready SaaS products and MVPs|works hands-on with real-world production systems');
  const [senderPortfolioUrl, setSenderPortfolioUrl] = useState('https://rafaytech.vercel.app');
  const [senderLinkedinUrl, setSenderLinkedinUrl] = useState('https://www.linkedin.com/in/abdulrafay-ai-mern');
  const [senderPhone, setSenderPhone] = useState('+92 306 0815246');

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
        const data = (await res.json()) as {
          setting?: {
            promptText?: string;
            senderName?: string;
            senderTitle?: string;
            senderPositioning?: string;
            senderPortfolioUrl?: string;
            senderLinkedinUrl?: string;
            senderPhone?: string;
          };
        };

        if (data.setting) {
          setPromptText(data.setting.promptText ?? '');
          setSenderName(data.setting.senderName ?? 'Abdul Rafay');
          setSenderTitle(data.setting.senderTitle ?? 'Senior Full Stack AI Developer');
          setSenderPositioning(data.setting.senderPositioning ?? 'builds production web and AI applications|has shipped 70+ production-ready SaaS products and MVPs|works hands-on with real-world production systems');
          setSenderPortfolioUrl(data.setting.senderPortfolioUrl ?? 'https://rafaytech.vercel.app');
          setSenderLinkedinUrl(data.setting.senderLinkedinUrl ?? 'https://www.linkedin.com/in/abdulrafay-ai-mern');
          setSenderPhone(data.setting.senderPhone ?? '+92 306 0815246');
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
        body: JSON.stringify({
          promptText,
          senderName,
          senderTitle,
          senderPositioning,
          senderPortfolioUrl,
          senderLinkedinUrl,
          senderPhone,
        }),
      });

      if (!res.ok) throw new Error('Failed to update prompt settings');
      setSuccessMsg('Global AI prompt & Sender Profile instructions saved successfully! All emails generated will automatically use these details.');
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
        title="Global AI Prompt & Sender Profile Settings"
        description="Configure your agency rules, custom AI pitch prompt, and Sender Profile details (Name, Portfolio, LinkedIn, Phone). All email outreach generated will use these instructions."
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
          <span className="text-sm font-semibold text-slate-500">Loading AI Prompt & Sender Configurations...</span>
        </div>
      ) : (
        <form onSubmit={(e) => { void handleSaveSettings(e); }} className="space-y-6">
          {/* Main Global Prompt Editor Card */}
          <Card className="border border-indigo-100 bg-gradient-to-br from-indigo-50/20 to-white shadow-sm">
            <CardHeader
              title="Custom Global Outreach Instructions"
              action={<SparklesIcon width={18} height={18} className="text-indigo-600" />}
            />
            <CardContent className="pt-2 space-y-4">
              <p className="text-xs text-slate-600 leading-relaxed">
                Enter your agency positioning, value proposition guarantees, tone guidelines, or specific call-to-actions.
                These instructions are appended to the AI engine for every lead email created.
              </p>

              <textarea
                rows={6}
                placeholder="e.g. We are an elite AI development agency. Always highlight our 2-week MVP delivery guarantee, keep email body under 90 words, and invite the lead for a free 15-minute technical audit call."
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                className="w-full text-xs font-mono font-medium text-slate-800 border border-slate-300 rounded-md p-4 focus:ring-2 focus:ring-indigo-500 focus:outline-none leading-relaxed bg-white"
              />
            </CardContent>
          </Card>

          {/* Sender Profile Settings Card */}
          <Card className="border border-slate-200 bg-white shadow-2xs">
            <CardHeader title="Sender Profile Details (Appended to Signatures & AI Context)" />
            <CardContent className="pt-2 space-y-4">
              <div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                    Sender Name
                  </label>
                  <input
                    type="text"
                    value={senderName}
                    onChange={(e) => setSenderName(e.target.value)}
                    required
                    className="w-full text-xs font-bold text-slate-800 border border-slate-200 rounded px-3 py-2 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                    Portfolio URL
                  </label>
                  <input
                    type="url"
                    value={senderPortfolioUrl}
                    onChange={(e) => setSenderPortfolioUrl(e.target.value)}
                    className="w-full text-xs font-mono font-semibold text-slate-800 border border-slate-200 rounded px-3 py-2 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                    LinkedIn URL
                  </label>
                  <input
                    type="url"
                    value={senderLinkedinUrl}
                    onChange={(e) => setSenderLinkedinUrl(e.target.value)}
                    className="w-full text-xs font-mono font-semibold text-slate-800 border border-slate-200 rounded px-3 py-2 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                    Phone / WhatsApp Number
                  </label>
                  <input
                    type="text"
                    value={senderPhone}
                    onChange={(e) => setSenderPhone(e.target.value)}
                    className="w-full text-xs font-mono font-bold text-slate-800 border border-slate-200 rounded px-3 py-2 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-3 border-t border-slate-100">
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
                  Save Global Settings & Sender Profile
                </Button>
              </div>
            </CardContent>
          </Card>


        </form>
      )}
    </div>
  );
}
