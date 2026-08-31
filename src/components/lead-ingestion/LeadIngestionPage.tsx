'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  createClientApi,
  getClientsApi,
  processRawLeadApi,
  updateLeadWebsiteApi,
  getIngestedLeadsApi,
  triggerLeadCrawlApi,
  generateLeadEmailApi,
  type ClientRecord,
  type LeadIngestionRecord,
} from '@/services/lead-ingestion/apiClient';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Input, Textarea } from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import {
  PlusCircleIcon,
  UsersIcon,
  LoaderIcon,
  CheckCircleIcon,
  AlertTriangleIcon,
  GlobeIcon,
  MailIcon,
  CopyIcon,
  EditIcon,
  ExternalLinkIcon,
  RefreshIcon,
  SparklesIcon,
} from '@/components/ui/Icons';
import { cn } from '@/lib/utils/cn';

function CopyEmailButton({ email }: { email: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex shrink-0 items-center gap-1 rounded-md border border-slate-200 px-2 py-0.5 text-[10px] text-slate-500 hover:bg-slate-50 hover:text-slate-700"
    >
      <CopyIcon width={10} height={10} />
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function RawLeadCard({
  lead,
  onWebsiteUpdated,
  onLeadUpdated,
  stylePrompt,
}: {
  lead: LeadIngestionRecord;
  onWebsiteUpdated: (updated: LeadIngestionRecord) => void;
  onLeadUpdated: (updated: LeadIngestionRecord) => void;
  stylePrompt: string;
}) {
  const [editing, setEditing] = useState(false);
  const [websiteInput, setWebsiteInput] = useState('');
  const [savingWebsite, setSavingWebsite] = useState(false);
  const [crawlingWebsite, setCrawlingWebsite] = useState(false);
  const [generatingEmail, setGeneratingEmail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);

  const startEdit = () => {
    setWebsiteInput(lead.websiteUrl || '');
    setEditing(true);
    setError(null);
  };

  const cancelEdit = () => {
    setEditing(false);
    setError(null);
  };

  const handleSaveWebsite = async () => {
    const trimmed = websiteInput.trim();
    if (!trimmed) return;
    setSavingWebsite(true);
    setError(null);
    try {
      const response = await updateLeadWebsiteApi(lead._id, trimmed);
      onWebsiteUpdated(response.result);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save website');
    } finally {
      setSavingWebsite(false);
    }
  };

  const handleTriggerCrawl = async () => {
    setCrawlingWebsite(true);
    setError(null);
    try {
      const response = await triggerLeadCrawlApi(lead._id);
      onLeadUpdated(response.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start website crawl');
    } finally {
      setCrawlingWebsite(false);
    }
  };

  const handleGenerateEmail = async () => {
    setGeneratingEmail(true);
    setError(null);
    try {
      const response = await generateLeadEmailApi(lead._id, stylePrompt);
      onLeadUpdated(response.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate outreach email');
    } finally {
      setGeneratingEmail(false);
    }
  };

  const isProcessing = lead.status === 'processing';
  const isFailed = lead.status === 'failed';
  const isCrawling = lead.crawlStatus === 'in_progress';

  // Parse validation reasons
  let validationReasons: string[] = [];
  if (lead.emailValidationDetails) {
    try {
      const parsed = JSON.parse(lead.emailValidationDetails) as { reasons?: string[] };
      validationReasons = parsed.reasons || [];
    } catch {
      // ignore
    }
  }

  return (
    <Card className="mb-4 overflow-hidden border border-slate-200 transition-all hover:shadow-md">
      <CardHeader
        title={lead.fullName || 'Uncertain Name'}
        action={
          <span className="flex items-center gap-1.5">
            {lead.status === 'processing' && (
              <Badge tone="info" icon={<LoaderIcon width={12} height={12} />}>
                Processing Raw Data
              </Badge>
            )}
            {lead.status === 'failed' && (
              <Badge tone="danger" icon={<AlertTriangleIcon width={12} height={12} />}>
                Failed Raw Data
              </Badge>
            )}
            {lead.status === 'completed' && (
              <Badge tone="success" icon={<CheckCircleIcon width={12} height={12} />}>
                Raw Data Processed
              </Badge>
            )}
            {isCrawling && (
              <Badge tone="info" icon={<LoaderIcon width={12} height={12} />}>
                Crawling Site
              </Badge>
            )}
            {lead.emailBody && (
              <Badge tone="success" icon={<SparklesIcon width={12} height={12} />}>
                Draft Ready
              </Badge>
            )}
          </span>
        }
      />
      <CardContent className="pt-2">
        {isProcessing && (
          <div className="flex flex-col items-center justify-center py-6 text-slate-500">
            <LoaderIcon width={24} height={24} className="mb-2 text-indigo-500" />
            <span className="text-sm font-medium">Extracting information using Regex & AI...</span>
          </div>
        )}

        {isFailed && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-800">
            <p className="font-semibold">Processing Failed</p>
            <p className="mt-0.5 text-xs text-red-600">
              An error occurred during raw text extraction. Please try re-pasting the raw text.
            </p>
          </div>
        )}

        {lead.status === 'completed' && (
          <div className="space-y-4">
            {/* AI Summary paragraph */}
            {lead.summary && (
              <div className="rounded-md border-l-4 border-indigo-500 bg-slate-50 p-3 text-sm text-slate-700 italic">
                {lead.summary}
              </div>
            )}

            {/* Extracted Details Grid */}
            <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              {/* Primary Email */}
              <div className="space-y-1">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                  Primary Contact Email
                </span>
                <div className="flex items-center gap-2">
                  <MailIcon width={14} height={14} className="shrink-0 text-slate-400" />
                  <span className="font-semibold text-slate-800 truncate">
                    {lead.email || 'None discovered'}
                  </span>
                  {lead.email && <StatusBadge value={lead.emailValidationStatus} />}
                </div>
              </div>

              {/* Phone Number */}
              <div className="space-y-1">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                  Phone Number
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-400 text-xs shrink-0 w-3.5 text-center">#</span>
                  <span className="text-slate-800 truncate">{lead.phoneNumber || 'Not found'}</span>
                </div>
              </div>
            </div>

            {/* Discovered Emails List */}
            {lead.discoveredEmails && lead.discoveredEmails.length > 0 && (
              <div className="space-y-1.5 border-t border-slate-100 pt-3">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                  Discovered Emails ({lead.discoveredEmails.length})
                </span>
                <ul className="divide-y divide-slate-100 bg-slate-50/50 rounded-md border border-slate-200/60 p-2 space-y-1">
                  {lead.discoveredEmails.map((email) => {
                    const isPrimary = lead.email === email;
                    return (
                      <li
                        key={email}
                        className="flex items-center justify-between py-1 first:pt-0 last:pb-0 text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="truncate font-medium text-slate-700">{email}</span>
                          {isPrimary && (
                            <span className="text-[10px] text-indigo-600 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded-full font-bold">
                              Primary
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <CopyEmailButton email={email} />
                          {isPrimary && <StatusBadge value={lead.emailValidationStatus} />}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* SMTP Verification Reasons Log */}
            {validationReasons.length > 0 && (
              <div className="border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => setShowLogs(!showLogs)}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-700 flex items-center gap-1.5"
                >
                  <span className="font-mono">{showLogs ? '▼' : '▶'}</span>
                  SMTP Mailbox Verification Log
                </button>
                {showLogs && (
                  <div className="mt-2 text-xs bg-slate-900 text-slate-300 font-mono p-3 rounded-md border border-slate-950 shadow-inner max-h-[160px] overflow-y-auto">
                    <ul className="list-disc pl-4 space-y-1">
                      {validationReasons.map((r, idx) => (
                        <li key={idx} className="leading-relaxed">
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Website Section */}
            <div className="border-t border-slate-100 pt-3">
              {editing ? (
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-500 uppercase">
                    Provide Website URL
                  </label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="text"
                      value={websiteInput}
                      onChange={(e) => setWebsiteInput(e.target.value)}
                      placeholder="e.g. https://company.com"
                      className="h-8 py-1 text-xs"
                      autoFocus
                    />
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleSaveWebsite}
                      disabled={savingWebsite || !websiteInput.trim()}
                    >
                      {savingWebsite ? 'Saving…' : 'Save'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={cancelEdit}
                      disabled={savingWebsite}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : lead.websiteUrl ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2 text-slate-600 truncate min-w-0">
                    <GlobeIcon width={14} height={14} className="shrink-0 text-indigo-500" />
                    <span className="font-semibold text-slate-500 text-sm">Website:</span>
                    <a
                      href={
                        /^https?:\/\//i.test(lead.websiteUrl)
                          ? lead.websiteUrl
                          : `https://${lead.websiteUrl}`
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate text-indigo-600 underline decoration-indigo-200 underline-offset-2 hover:text-indigo-700 text-sm"
                    >
                      {lead.websiteUrl}
                    </a>
                    <ExternalLinkIcon width={12} height={12} className="text-slate-400 shrink-0" />
                  </div>

                  <div className="flex items-center gap-3 self-end shrink-0">
                    <button
                      type="button"
                      onClick={handleGenerateEmail}
                      disabled={generatingEmail || isProcessing || isCrawling}
                      className="text-indigo-600 hover:text-indigo-700 disabled:text-slate-400 flex items-center gap-1 text-xs font-semibold"
                    >
                      {generatingEmail ? (
                        <LoaderIcon width={12} height={12} />
                      ) : (
                        <SparklesIcon width={12} height={12} className="text-indigo-500" />
                      )}
                      {lead.emailBody ? 'Regenerate Email' : 'Generate Email'}
                    </button>
                    <button
                      type="button"
                      onClick={handleTriggerCrawl}
                      disabled={isCrawling || crawlingWebsite || generatingEmail}
                      className="text-slate-600 hover:text-slate-800 disabled:text-slate-400 flex items-center gap-1 text-xs font-semibold"
                    >
                      {isCrawling || crawlingWebsite ? (
                        <LoaderIcon width={12} height={12} />
                      ) : (
                        <RefreshIcon width={12} height={12} />
                      )}
                      Crawl Website
                    </button>
                    <button
                      type="button"
                      onClick={startEdit}
                      disabled={generatingEmail || isCrawling}
                      className="text-slate-400 hover:text-slate-600 flex items-center gap-1 text-xs disabled:text-slate-200"
                    >
                      <EditIcon width={12} height={12} />
                      Edit URL
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-amber-200 bg-amber-50/50 p-3">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangleIcon width={16} height={16} className="text-amber-600 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-amber-800">
                        Website link not found. Give website link for this raw data.
                      </p>
                      <button
                        type="button"
                        onClick={startEdit}
                        className="mt-2 text-xs font-semibold text-amber-900 underline hover:text-amber-950 flex items-center gap-1"
                      >
                        <PlusCircleIcon width={12} height={12} />
                        Add Website URL
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function LeadIngestionPage() {
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [activeClient, setActiveClient] = useState<ClientRecord | null>(null);
  const [clientName, setClientName] = useState('');
  const [rawText, setRawText] = useState('');
  const [stylePrompt, setStylePrompt] = useState('');
  const [leads, setLeads] = useState<LeadIngestionRecord[]>([]);

  const [loadingClients, setLoadingClients] = useState(false);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load clients list
  const loadClients = async () => {
    setLoadingClients(true);
    try {
      const response = await getClientsApi();
      setClients(response.clients);
      if (response.clients.length > 0 && !activeClient) {
        setActiveClient(response.clients[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load clients list');
    } finally {
      setLoadingClients(false);
    }
  };

  // Load leads list for active client
  const loadLeadsForClient = async (clientId: string, silent = false) => {
    if (!silent) setLoadingLeads(true);
    try {
      const response = await getIngestedLeadsApi(clientId);
      setLeads(response.results);
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : 'Failed to load leads list');
    } finally {
      if (!silent) setLoadingLeads(false);
    }
  };

  useEffect(() => {
    loadClients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeClient) {
      loadLeadsForClient(activeClient._id);
    } else {
      setLeads([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClient]);

  // Set up polling while any lead is in 'processing' status or 'in_progress' crawlStatus
  useEffect(() => {
    if (!activeClient) return undefined;

    const needsPolling = leads.some(
      (lead) => lead.status === 'processing' || lead.crawlStatus === 'in_progress'
    );
    if (!needsPolling) return undefined;

    const interval = setInterval(() => {
      loadLeadsForClient(activeClient._id, true);
    }, 3000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, activeClient]);

  const handleAddClient = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = clientName.trim();
    if (!name) return;

    setError(null);
    try {
      const response = await createClientApi(name);
      setClients((prev) => [response.client, ...prev]);
      setActiveClient(response.client);
      setClientName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create client');
    }
  };

  const handleAddRawLead = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = rawText.trim();
    if (!text || !activeClient) return;

    setIsProcessing(true);
    setError(null);
    setRawText('');

    // Pre-insert a temporary processing record for UI responsiveness
    const tempId = Math.random().toString();
    const tempLead: LeadIngestionRecord = {
      _id: tempId,
      clientId: activeClient._id,
      rawText: text,
      summary: null,
      fullName: null,
      email: null,
      phoneNumber: null,
      websiteUrl: null,
      status: 'processing',
      discoveredEmails: [],
      emailValidationStatus: 'pending',
      emailValidationDetails: null,
      crawlStatus: 'not_started',
      emailSubject: null,
      emailBody: null,
      approved: false,
      emailStatus: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setLeads((prev) => [tempLead, ...prev]);

    try {
      const response = await processRawLeadApi(activeClient._id, text);
      // Replace the temp lead with the real response
      setLeads((prev) =>
        prev.map((item) => (item._id === tempId ? response.result : item))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process lead');
      // Mark as failed in UI
      setLeads((prev) =>
        prev.map((item) => (item._id === tempId ? { ...item, status: 'failed' } : item))
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleWebsiteUpdated = (updated: LeadIngestionRecord) => {
    setLeads((prev) => prev.map((item) => (item._id === updated._id ? updated : item)));
  };

  const handleLeadUpdated = (updated: LeadIngestionRecord) => {
    setLeads((prev) => prev.map((item) => (item._id === updated._id ? updated : item)));
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <PageHeader
          title="Client Intelligence Ingestion"
          description="Add clients and paste raw LinkedIn details to extract contact information using Regex & AI."
        />
        {activeClient && (
          <Link
            href="/lead-ingestion/emails"
            className="inline-flex items-center gap-1.5 self-start sm:self-center px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md shadow-sm transition-colors"
          >
            <SparklesIcon width={16} height={16} />
            View Outreach Emails &rarr;
          </Link>
        )}
      </div>

      {error && (
        <div className="mb-6 flex items-start gap-2.5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangleIcon width={16} height={16} className="shrink-0 mt-0.5 text-red-600" />
          <div className="flex-1">
            <span className="font-semibold">Error:</span> {error}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* Left Column: Clients List */}
        <div className="md:col-span-1 space-y-6">
          <Card>
            <CardHeader
              title="Clients"
              action={<UsersIcon width={16} height={16} className="text-slate-400" />}
            />
            <CardContent className="pt-2">
              <form onSubmit={handleAddClient} className="mb-4">
                <div className="flex flex-col gap-2">
                  <Input
                    type="text"
                    placeholder="New client name..."
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    className="h-9"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!clientName.trim()}
                    className="w-full flex items-center justify-center gap-1.5"
                  >
                    <PlusCircleIcon width={14} height={14} />
                    Add Client
                  </Button>
                </div>
              </form>

              {loadingClients ? (
                <div className="flex items-center justify-center py-6">
                  <LoaderIcon width={20} height={20} className="text-indigo-500 animate-spin" />
                </div>
              ) : clients.length === 0 ? (
                <div className="text-center py-6 text-slate-400 text-sm">
                  No clients created yet.
                </div>
              ) : (
                <ul className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
                  {clients.map((client) => {
                    const isSelected = activeClient?._id === client._id;
                    return (
                      <li key={client._id}>
                        <button
                          type="button"
                          onClick={() => setActiveClient(client)}
                          className={cn(
                            'w-full text-left px-3 py-2 text-sm rounded-md transition-all font-medium flex items-center justify-between',
                            isSelected
                              ? 'bg-indigo-600 text-white shadow-sm'
                              : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 border border-transparent'
                          )}
                        >
                          <span className="truncate">{client.name}</span>
                          <span
                            className={cn(
                              'text-[10px] px-1.5 py-0.5 rounded-full font-bold',
                              isSelected ? 'bg-indigo-500/50 text-white' : 'bg-slate-100 text-slate-500'
                            )}
                          >
                            active
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Lead Ingestion */}
        <div className="md:col-span-2 space-y-6">
          {activeClient ? (
            <>
              {/* Ingestion Input Card */}
              <Card>
                <CardHeader title={`Add LinkedIn Raw Info - ${activeClient.name}`} />
                <CardContent className="pt-2">
                  <form onSubmit={handleAddRawLead} className="flex flex-col gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-500 uppercase">
                        LinkedIn Raw Details
                      </label>
                      <Textarea
                        rows={8}
                        placeholder="Paste LinkedIn profile, company about info, or raw page copies here..."
                        value={rawText}
                        onChange={(e) => setRawText(e.target.value)}
                        className="font-mono text-xs leading-relaxed"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-500 uppercase">
                        Custom Outreach Email Style / Prompt (Optional)
                      </label>
                      <Input
                        type="text"
                        placeholder="e.g. Write in a very short, casual MERN-focused tone"
                        value={stylePrompt}
                        onChange={(e) => setStylePrompt(e.target.value)}
                        className="h-9 text-xs"
                      />
                    </div>

                    <Button
                      type="submit"
                      disabled={!rawText.trim() || isProcessing}
                      isLoading={isProcessing}
                      className="self-start"
                    >
                      {isProcessing ? 'Processing…' : 'Add Raw Lead'}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              {/* Ingested Leads List */}
              <div>
                <h3 className="text-sm font-semibold tracking-wide text-slate-500 uppercase mb-3">
                  Ingested Leads ({leads.length})
                </h3>

                {loadingLeads ? (
                  <div className="flex items-center justify-center py-12">
                    <LoaderIcon width={24} height={24} className="text-indigo-500 animate-spin" />
                  </div>
                ) : leads.length === 0 ? (
                  <Card className="py-12 border-dashed border-2 border-slate-200">
                    <div className="text-center text-slate-400 text-sm">
                      No raw leads processed for {activeClient.name} yet. Paste raw data above to begin.
                    </div>
                  </Card>
                ) : (
                  <div>
                    {leads.map((lead) => (
                      <RawLeadCard
                        key={lead._id}
                        lead={lead}
                        onWebsiteUpdated={handleWebsiteUpdated}
                        onLeadUpdated={handleLeadUpdated}
                        stylePrompt={stylePrompt}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <Card className="py-12 border-dashed border-2 border-slate-200 flex flex-col items-center justify-center text-slate-400">
              <UsersIcon width={36} height={36} className="text-slate-300 mb-2" />
              <div className="text-sm">Please select or add a client from the left pane.</div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
