'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import {
  getClientsApi,
  getIngestedLeadsApi,
  updateLeadDetailsApi,
  refineLeadEmailApi,
  bulkSendEmailsApi,
  type ClientRecord,
  type LeadIngestionRecord,
} from '@/services/lead-ingestion/apiClient';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import {
  UsersIcon,
  LoaderIcon,
  CopyIcon,
  CheckCircleIcon,
  MailIcon,
  SparklesIcon,
  EditIcon,
  RefreshIcon,
  AlertTriangleIcon,
} from '@/components/ui/Icons';
import { cn } from '@/lib/utils/cn';

function RichTextEditor({
  initialValue,
  onChange,
}: {
  initialValue: string;
  onChange: (html: string) => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);

  const executeCmd = (command: string, value = '') => {
    document.execCommand(command, false, value);
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  };

  return (
    <div className="border border-slate-200 rounded-md overflow-hidden bg-white">
      {/* WYSIWYG Toolbar */}
      <div className="flex flex-wrap items-center gap-1 bg-slate-50 border-b border-slate-200 px-3 py-2 text-xs">
        <button
          type="button"
          onClick={() => executeCmd('bold')}
          className="px-2 py-1 font-bold rounded hover:bg-slate-200 text-slate-700"
          title="Bold"
        >
          B
        </button>
        <button
          type="button"
          onClick={() => executeCmd('italic')}
          className="px-2 py-1 italic rounded hover:bg-slate-200 text-slate-700"
          title="Italic"
        >
          I
        </button>
        <button
          type="button"
          onClick={() => executeCmd('underline')}
          className="px-2 py-1 underline rounded hover:bg-slate-200 text-slate-700"
          title="Underline"
        >
          U
        </button>
        <span className="h-4 w-px bg-slate-300 mx-1" />
        <select
          onChange={(e) => executeCmd('fontSize', e.target.value)}
          className="bg-white border border-slate-200 rounded px-1.5 py-0.5 text-[11px] text-slate-600 focus:outline-none"
          title="Font Size"
        >
          <option value="3">Medium</option>
          <option value="2">Small</option>
          <option value="4">Large</option>
          <option value="5">X-Large</option>
        </select>
        <input
          type="color"
          onChange={(e) => executeCmd('foreColor', e.target.value)}
          className="w-5 h-5 p-0.5 border border-slate-200 rounded bg-white cursor-pointer"
          title="Text Color"
        />
      </div>

      {/* Contenteditable Area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={(e) => onChange((e.target as HTMLDivElement).innerHTML)}
        className="min-h-[160px] max-h-[300px] overflow-y-auto p-4 text-sm text-slate-700 focus:outline-none leading-relaxed"
        dangerouslySetInnerHTML={{ __html: initialValue }}
      />
    </div>
  );
}

function EmailDraftCard({
  lead,
  onLeadUpdated,
}: {
  lead: LeadIngestionRecord;
  onLeadUpdated: (updated: LeadIngestionRecord) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(lead.emailSubject || '');
  const [bodyHtml, setBodyHtml] = useState(lead.emailBody || '');
  const [refinePrompt, setRefinePrompt] = useState('');

  const [saving, setSaving] = useState(false);
  const [refining, setRefining] = useState(false);
  const [copiedSubject, setCopiedSubject] = useState(false);
  const [copiedBody, setCopiedBody] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCopySubject = async () => {
    try {
      await navigator.clipboard.writeText(lead.emailSubject || '');
      setCopiedSubject(true);
      setTimeout(() => setCopiedSubject(false), 1500);
    } catch {
      // ignore
    }
  };

  const handleCopyBody = async () => {
    try {
      // Strip HTML tags for clean body text clipboard copy
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = lead.emailBody || '';
      const textBody = tempDiv.innerText || tempDiv.textContent || '';
      await navigator.clipboard.writeText(textBody);
      setCopiedBody(true);
      setTimeout(() => setCopiedBody(false), 1500);
    } catch {
      // ignore
    }
  };

  const handleCopyAll = async () => {
    try {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = lead.emailBody || '';
      const textBody = tempDiv.innerText || tempDiv.textContent || '';
      const fullText = `Subject: ${lead.emailSubject}\n\n${textBody}`;
      await navigator.clipboard.writeText(fullText);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1500);
    } catch {
      // ignore
    }
  };

  const handleToggleApproval = async () => {
    setError(null);
    try {
      const nextApproved = !lead.approved;
      const response = await updateLeadDetailsApi(lead._id, { approved: nextApproved });
      onLeadUpdated(response.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update approval status');
    }
  };

  const handleSaveEdits = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await updateLeadDetailsApi(lead._id, {
        emailSubject: subject,
        emailBody: bodyHtml,
      });
      onLeadUpdated(response.result);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const handleImproveWithAi = async () => {
    const promptText = refinePrompt.trim();
    if (!promptText) return;
    setRefining(true);
    setError(null);
    try {
      const response = await refineLeadEmailApi(lead._id, promptText);
      onLeadUpdated(response.result);
      setSubject(response.result.emailSubject || '');
      setBodyHtml(response.result.emailBody || '');
      setRefinePrompt('');
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI refinement failed');
    } finally {
      setRefining(false);
    }
  };

  const isSent = lead.emailStatus === 'sent';
  const isSending = lead.emailStatus === 'sending';
  const isFailed = lead.emailStatus === 'failed';

  return (
    <Card className="mb-6 overflow-hidden border border-slate-200 shadow-sm transition-all hover:shadow-md">
      <CardHeader
        title={
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-slate-900">
              {lead.companyName ? `${lead.companyName} (${lead.fullName || 'Candidate'})` : (lead.fullName || 'Uncertain Lead')}
            </span>
            {lead.jobTitle && (
              <span className="text-[11px] px-2 py-0.5 rounded font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100">
                {lead.jobTitle}
              </span>
            )}
          </div>
        }
        action={
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500 font-semibold truncate max-w-[140px] sm:max-w-none">
              {lead.email}
            </span>

            {/* Email Status Badges */}
            {isSent && <Badge tone="success">Sent</Badge>}
            {isSending && (
              <Badge tone="info" icon={<LoaderIcon width={12} height={12} />}>
                Sending
              </Badge>
            )}
            {isFailed && <Badge tone="danger">Failed</Badge>}

            {!isSending && !isSent && (
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 px-2 py-1 rounded cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={lead.approved}
                  onChange={handleToggleApproval}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                />
                Approved
              </label>
            )}

            <button
              type="button"
              onClick={handleCopyAll}
              className="flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
            >
              {copiedAll ? <CheckCircleIcon width={12} height={12} /> : <CopyIcon width={12} height={12} />}
              {copiedAll ? 'Copied!' : 'Copy Full'}
            </button>
          </div>
        }
      />
      <CardContent className="pt-3 space-y-4">
        {editing ? (
          <div className="space-y-4">
            {/* Subject Input */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Subject Line
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full text-sm font-semibold text-slate-900 border border-slate-200 rounded-md px-3 py-2 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>

            {/* Rich Editor Component */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Email HTML Body
              </label>
              <RichTextEditor initialValue={bodyHtml} onChange={setBodyHtml} />
            </div>

            {/* AI Refine Panel */}
            <div className="bg-indigo-50/50 border border-indigo-100 rounded-md p-3 space-y-2">
              <label className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider block">
                AI Refinement Instruction
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. Rewrite the opening, or make the email tone more casual"
                  value={refinePrompt}
                  onChange={(e) => setRefinePrompt(e.target.value)}
                  className="flex-1 text-xs border border-slate-200 rounded-md px-3 py-1.5 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleImproveWithAi}
                  disabled={refining || !refinePrompt.trim()}
                  className="text-indigo-600 border-indigo-200 hover:bg-indigo-100 flex items-center gap-1.5"
                >
                  {refining ? <LoaderIcon width={12} height={12} /> : <SparklesIcon width={12} height={12} />}
                  Improve with AI
                </Button>
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <Button type="button" size="sm" onClick={handleSaveEdits} disabled={saving}>
                {saving ? 'Saving...' : 'Save Draft'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setSubject(lead.emailSubject || '');
                  setBodyHtml(lead.emailBody || '');
                  setEditing(false);
                }}
                disabled={saving}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Subject Line Display */}
            <div className="space-y-1 bg-slate-50 border border-slate-200 rounded-md p-3">
              <div className="flex items-center justify-between gap-3 mb-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Subject Line
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="flex items-center gap-0.5 text-[11px] text-slate-400 hover:text-slate-600 mr-2"
                  >
                    <EditIcon width={11} height={11} />
                    Edit Draft
                  </button>
                  <button
                    type="button"
                    onClick={handleCopySubject}
                    className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800"
                  >
                    {copiedSubject ? <CheckCircleIcon width={11} height={11} /> : <CopyIcon width={11} height={11} />}
                    {copiedSubject ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
              <p className="text-sm font-semibold text-slate-900 leading-snug">{lead.emailSubject}</p>
            </div>

            {/* HTML Body Display */}
            <div className="space-y-1 border border-slate-200 rounded-md p-4 bg-white relative">
              <div className="flex items-center justify-between gap-3 mb-2 border-b border-slate-100 pb-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Email Body (Rich HTML)
                </span>
                <button
                  type="button"
                  onClick={handleCopyBody}
                  className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800"
                >
                  {copiedBody ? <CheckCircleIcon width={11} height={11} /> : <CopyIcon width={11} height={11} />}
                  {copiedBody ? 'Copied' : 'Copy Clean'}
                </button>
              </div>
              {/* Display HTML safely as generated by our internal compiler */}
              <div
                className="text-sm text-slate-700 space-y-3 leading-relaxed"
                dangerouslySetInnerHTML={{ __html: lead.emailBody || '' }}
              />
            </div>
          </div>
        )}

        {error && <p className="text-xs text-red-600 font-semibold">{error}</p>}
      </CardContent>
    </Card>
  );
}

export default function OutreachEmailsPage() {
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [activeClient, setActiveClient] = useState<ClientRecord | null>(null);
  const [leads, setLeads] = useState<LeadIngestionRecord[]>([]);
  const [activeTab, setActiveTab] = useState<'drafts' | 'approved'>('drafts');

  const [loadingClients, setLoadingClients] = useState(false);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [bulkSending, setBulkSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

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
      setSuccessMsg(null);
    } else {
      setLeads([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClient]);

  // Polling for sending status updates
  useEffect(() => {
    if (!activeClient) return undefined;

    const isSending = leads.some((lead) => lead.emailStatus === 'sending');
    if (!isSending) {
      if (bulkSending) setBulkSending(false);
      return undefined;
    }

    const interval = setInterval(() => {
      loadLeadsForClient(activeClient._id, true);
    }, 2500);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, activeClient]);

  const handleBulkSend = async () => {
    if (!activeClient) return;
    setBulkSending(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const response = await bulkSendEmailsApi(activeClient._id);
      setSuccessMsg(response.message);
      // Immediately refresh local statuses to 'sending'
      loadLeadsForClient(activeClient._id, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger bulk sending');
      setBulkSending(false);
    }
  };

  const handleLeadUpdated = (updated: LeadIngestionRecord) => {
    setLeads((prev) => prev.map((item) => (item._id === updated._id ? updated : item)));
  };

  // Grouping
  const allDrafts = leads.filter((lead) => lead.emailSubject && lead.emailBody);
  const draftsOnly = allDrafts.filter((lead) => !lead.approved);
  const approvedQueue = allDrafts.filter((lead) => lead.approved);

  const displayLeads = activeTab === 'drafts' ? draftsOnly : approvedQueue;

  const countPendingSend = approvedQueue.filter(
    (lead) => lead.emailStatus === 'draft' || lead.emailStatus === 'failed'
  ).length;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <Link
        href="/lead-ingestion"
        className="inline-flex items-center gap-1.5 text-slate-500 hover:text-slate-800 text-xs font-semibold mb-4 transition-colors"
      >
        &larr; Back to Ingestion Dashboard
      </Link>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <PageHeader
          title="Outreach Drafts Dashboard"
          description="Edit, refine, approve, and bulk dispatch AI-personalized emails via Gmail SMTP."
        />
        {activeClient && approvedQueue.length > 0 && (
          <button
            type="button"
            onClick={handleBulkSend}
            disabled={bulkSending || countPendingSend === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:text-slate-500 rounded-md shadow-sm transition-colors"
          >
            {bulkSending ? (
              <LoaderIcon width={16} height={16} className="animate-spin" />
            ) : (
              <MailIcon width={16} height={16} />
            )}
            {bulkSending
              ? 'Sending Queue...'
              : `Send Approved Emails (${countPendingSend} pending)`}
          </button>
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

      {successMsg && (
        <div className="mb-6 flex items-start gap-2.5 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          <CheckCircleIcon width={16} height={16} className="shrink-0 mt-0.5 text-green-600" />
          <div className="flex-1">
            <span className="font-semibold">Success:</span> {successMsg}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* Left Column: Clients List */}
        <div className="md:col-span-1 space-y-6">
          <Card>
            <CardHeader
              title="Select Client"
              action={<UsersIcon width={16} height={16} className="text-slate-400" />}
            />
            <CardContent className="pt-2">
              {loadingClients ? (
                <div className="flex items-center justify-center py-6">
                  <LoaderIcon width={20} height={20} className="text-indigo-500 animate-spin" />
                </div>
              ) : clients.length === 0 ? (
                <div className="text-center py-6 text-slate-400 text-sm">
                  No clients created yet.
                </div>
              ) : (
                <ul className="space-y-1.5 max-h-[400px] overflow-y-auto pr-1">
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

        {/* Right Column: Outreach Email Drafts */}
        <div className="md:col-span-2 space-y-4">
          {activeClient ? (
            <>
              {/* Tab Navigation */}
              <div className="flex border-b border-slate-200">
                <button
                  type="button"
                  onClick={() => setActiveTab('drafts')}
                  className={cn(
                    'px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-all',
                    activeTab === 'drafts'
                      ? 'border-indigo-600 text-indigo-600 font-bold'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  )}
                >
                  Drafts ({draftsOnly.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('approved')}
                  className={cn(
                    'px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-all',
                    activeTab === 'approved'
                      ? 'border-indigo-600 text-indigo-600 font-bold'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  )}
                >
                  Approved Queue ({approvedQueue.length})
                </button>
              </div>

              {loadingLeads ? (
                <div className="flex items-center justify-center py-12">
                  <LoaderIcon width={24} height={24} className="text-indigo-500 animate-spin" />
                </div>
              ) : displayLeads.length === 0 ? (
                <Card className="py-12 border-dashed border-2 border-slate-200 flex flex-col items-center justify-center text-slate-400">
                  <SparklesIcon width={36} height={36} className="text-slate-300 mb-2" />
                  <div className="text-sm mb-1 font-semibold text-slate-500">
                    No leads in this section
                  </div>
                  <div className="text-xs text-center max-w-sm px-4">
                    {activeTab === 'drafts'
                      ? 'No drafts found. Generate emails on processed leads inside Ingestion.'
                      : 'No approved drafts yet. Toggle "Approved" on drafts to move them here.'}
                  </div>
                </Card>
              ) : (
                <div className="pt-2">
                  {displayLeads.map((lead) => (
                    <EmailDraftCard
                      key={lead._id}
                      lead={lead}
                      onLeadUpdated={handleLeadUpdated}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <Card className="py-12 border-dashed border-2 border-slate-200 flex flex-col items-center justify-center text-slate-400">
              <UsersIcon width={36} height={36} className="text-slate-300 mb-2" />
              <div className="text-sm">
                Please select a client from the left pane to view their email drafts.
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
