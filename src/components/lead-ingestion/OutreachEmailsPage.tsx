'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  updateLeadDetailsApi,
  refineLeadEmailApi,
  crawlLeadWebsiteApi,
  type ClientRecord,
  type LeadIngestionRecord,
  type VerifiedEmailItem,
} from '@/services/lead-ingestion/apiClient';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  LoaderIcon,
  CopyIcon,
  CheckCircleIcon,
  MailIcon,
  SparklesIcon,
  EditIcon,
  ExternalLinkIcon,
  AlertTriangleIcon,
  XIcon,
  GlobeIcon,
  RefreshIcon,
  PlusCircleIcon,
} from '@/components/ui/Icons';

// ── Types ─────────────────────────────────────────────────────────────────────

interface GeneratedEmailItem {
  id: string;
  leadId: string;
  clientId?: string;
  candidateName: string;
  clientName: string;
  linkedinUrl?: string | null;
  companyName: string;
  jobTitle: string | null;
  targetEmail: string;
  emailStatus: VerifiedEmailItem['status'];
  subject: string;
  bodyHtml: string;
  approved: boolean;
  sendStatus: 'pending' | 'in_progress' | 'delivered' | 'opened' | 'failed' | 'no_contact_email';
  companyIndex: number;
}

function SmtpBadge({ status }: { status: VerifiedEmailItem['status'] }) {
  if (status === 'valid') return <Badge tone="success">✓ Verified SMTP</Badge>;
  if (status === 'invalid') return <Badge tone="danger">❌ Invalid SMTP</Badge>;
  if (status === 'risky') return <Badge tone="warning">⚠️ Risky SMTP</Badge>;
  return <Badge tone="warning">⚡ SMTP Not Verified</Badge>;
}

function SendStatusBadge({ status }: { status: GeneratedEmailItem['sendStatus'] }) {
  if (status === 'no_contact_email') return <Badge tone="warning">⚠️ No Contact Email</Badge>;
  if (status === 'opened') return <Badge tone="info">Opened</Badge>;
  if (status === 'delivered') return <Badge tone="success">Delivered</Badge>;
  if (status === 'failed') return <Badge tone="danger">Failed</Badge>;
  if (status === 'in_progress') return <Badge tone="info" icon={<LoaderIcon width={11} height={11} className="animate-spin" />}>In Progress</Badge>;
  return <Badge tone="neutral">Pending</Badge>;
}

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
      </div>

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

// ── Custom Styled Vertical Dropdown Component ─────────────────────────────────

function CustomSelect<T extends string>({
  value,
  options,
  onChange,
  widthClass = 'w-48',
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (val: T) => void;
  widthClass?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeOption = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative inline-block text-xs">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={[
          'bg-white border border-slate-200 rounded-md px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 flex items-center justify-between gap-2 shadow-2xs transition-colors',
          widthClass,
        ].join(' ')}
      >
        <span className="truncate">{activeOption.label}</span>
        <span className="text-[9px] text-slate-400 shrink-0">▼</span>
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-1 w-full min-w-[180px] bg-white border border-slate-200 rounded-md shadow-xl z-50 p-1 flex flex-col space-y-1">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setIsOpen(false);
              }}
              className={[
                'w-full text-left px-3 py-2 rounded-md text-xs font-semibold transition-colors block leading-snug truncate shrink-0',
                opt.value === value ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-700 hover:bg-slate-50',
              ].join(' ')}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Searchable Client Dropdown Component ──────────────────────────────────────

function SearchableClientSelect({
  selectedClientId,
  onSelectClient,
}: {
  selectedClientId: string;
  onSelectClient: (clientId: string, clientName: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [selectedName, setSelectedName] = useState('All Clients');
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchClients = useCallback(async (query: string, targetPage: number, isInitial = false) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: targetPage.toString(),
        limit: '10',
        ...(query.trim() ? { search: query.trim() } : {}),
      });

      const res = await fetch(`/api/clients?${params.toString()}`);
      if (!res.ok) return;
      const data = (await res.json()) as { clients?: ClientRecord[]; hasMore?: boolean };

      const fetched = data.clients ?? [];
      if (isInitial) {
        setClients(fetched);
      } else {
        setClients((prev) => [...prev, ...fetched]);
      }

      setHasMore(!!data.hasMore);
      setPage(targetPage);
    } catch { /* ignore */ }
    finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchClients(search, 1, true);
    }, 250);
    return () => clearTimeout(timer);
  }, [search, fetchClients]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop <= clientHeight + 10 && hasMore && !loading) {
      void fetchClients(search, page + 1, false);
    }
  };

  return (
    <div ref={containerRef} className="relative inline-block text-xs">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="bg-white border border-slate-200 rounded-md px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 flex items-center justify-between gap-2 w-48 shadow-2xs transition-colors"
      >
        <span className="truncate">{selectedName}</span>
        <span className="text-[9px] text-slate-400 shrink-0">▼</span>
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-1 w-64 bg-white border border-slate-200 rounded-md shadow-xl z-50 p-2 space-y-2">
          <input
            type="text"
            placeholder="Type to search clients..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-xs border border-slate-200 rounded-md px-2.5 py-1.5 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            autoFocus
          />

          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="max-h-52 overflow-y-auto space-y-1 py-1 pr-1"
          >
            <button
              type="button"
              onClick={() => {
                onSelectClient('all', 'All Clients');
                setSelectedName('All Clients');
                setIsOpen(false);
              }}
              className={[
                'w-full text-left px-3 py-2 rounded-md text-xs font-semibold transition-colors block truncate leading-normal shrink-0',
                selectedClientId === 'all' ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-700 hover:bg-slate-50',
              ].join(' ')}
            >
              All Clients
            </button>

            {clients.map((c) => (
              <button
                key={c._id}
                type="button"
                onClick={() => {
                  onSelectClient(c._id, c.name);
                  setSelectedName(c.name);
                  setIsOpen(false);
                }}
                className={[
                  'w-full text-left px-3 py-2 rounded-md text-xs font-semibold transition-colors block truncate leading-normal shrink-0',
                  selectedClientId === c._id ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-700 hover:bg-slate-50',
                ].join(' ')}
              >
                {c.name}
              </button>
            ))}

            {loading && (
              <div className="py-2 text-center text-[10px] text-slate-400 flex items-center justify-center gap-1">
                <LoaderIcon width={10} height={10} className="animate-spin text-indigo-500" />
                Loading clients...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Email Details & Edit Modal Window ─────────────────────────────────────────

function EmailEditModal({
  emailItem,
  leadDoc,
  onClose,
  onLeadUpdated,
}: {
  emailItem: GeneratedEmailItem;
  leadDoc: LeadIngestionRecord;
  onClose: () => void;
  onLeadUpdated: (updated: LeadIngestionRecord) => void;
}) {
  const [currentLead, setCurrentLead] = useState<LeadIngestionRecord>(leadDoc);
  const [targetEmailInput, setTargetEmailInput] = useState(emailItem.targetEmail);
  const [multipleEmailsInput, setMultipleEmailsInput] = useState('');
  const [subjectInput, setSubjectInput] = useState(emailItem.subject);
  const [bodyHtmlInput, setBodyHtmlInput] = useState(emailItem.bodyHtml);
  const [isApproved, setIsApproved] = useState(emailItem.approved);
  const [refinePrompt, setRefinePrompt] = useState('');

  // Web Crawling state inside modal
  const compObj = currentLead.currentCompanies?.[emailItem.companyIndex];
  const initialWebUrl = emailItem.companyIndex === -1
    ? (currentLead.portfolioUrl || currentLead.websiteUrl || '')
    : (compObj?.websiteUrl || currentLead.websiteUrl || '');
  const [websiteUrlInput, setWebsiteUrlInput] = useState(initialWebUrl);
  const [crawling, setCrawling] = useState(false);
  const [verifyingEmail, setVerifyingEmail] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [refining, setRefining] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const verifiedMap = new Map<string, VerifiedEmailItem['status']>();
  (currentLead.verifiedEmails ?? []).forEach((v) => verifiedMap.set(v.email, v.status));

  // Determine current list of emails for this specific box
  const availableEmails: string[] = Array.from(new Set(
    emailItem.companyIndex === -1
      ? (currentLead.discoveredEmails ?? (currentLead.email ? [currentLead.email] : []))
      : (compObj?.companyEmails ?? [])
  ));

  const targetStatus = targetEmailInput.trim() ? (verifiedMap.get(targetEmailInput.trim().toLowerCase()) ?? 'pending') : null;

  // Handler: Crawl Website directly inside Modal
  const handleCrawlWebsiteInModal = async () => {
    if (!websiteUrlInput.trim()) return;
    setCrawling(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const updatedCompanies = [...(currentLead.currentCompanies ?? [])];
      if (emailItem.companyIndex !== -1 && updatedCompanies[emailItem.companyIndex]) {
        updatedCompanies[emailItem.companyIndex].websiteUrl = websiteUrlInput.trim();
      }
      await updateLeadDetailsApi(emailItem.leadId, {
        currentCompanies: updatedCompanies,
        ...(emailItem.companyIndex === -1 ? { portfolioUrl: websiteUrlInput.trim() } : {}),
      });

      const crawlRes = await crawlLeadWebsiteApi(
        emailItem.leadId,
        websiteUrlInput.trim(),
        [],
        emailItem.companyIndex === -1 ? undefined : emailItem.companyIndex
      );

      setCurrentLead(crawlRes.result);
      onLeadUpdated(crawlRes.result);

      const freshComp = crawlRes.result.currentCompanies?.[emailItem.companyIndex];
      const freshEmails = emailItem.companyIndex === -1
        ? (crawlRes.result.discoveredEmails ?? [])
        : (freshComp?.companyEmails ?? []);

      if (freshEmails.length > 0 && !targetEmailInput) {
        setTargetEmailInput(freshEmails[0]);
      }

      setSuccessMsg(`✓ Extracted emails from ${websiteUrlInput.trim()}! Total: ${freshEmails.length} email(s).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to crawl website');
    } finally {
      setCrawling(false);
    }
  };

  // Handler: Single Email SMTP Re-verify directly inside Modal
  const handleVerifyEmailInModal = async (emailToVerify: string) => {
    if (!emailToVerify.trim()) return;
    setVerifyingEmail(emailToVerify);
    setError(null);
    try {
      const res = await updateLeadDetailsApi(emailItem.leadId, {
        ...(emailItem.companyIndex === -1
          ? { forceVerifyEmail: emailToVerify.trim() }
          : { verifyCompanyEmails: [emailToVerify.trim()] }),
      });
      setCurrentLead(res.result);
      onLeadUpdated(res.result);
      setSuccessMsg(`✓ SMTP verification completed for ${emailToVerify.trim()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SMTP verification failed');
    } finally {
      setVerifyingEmail(null);
    }
  };

  // Handler: Add Multiple Emails & SMTP Verify directly inside Modal
  const handleAddMultipleEmails = async () => {
    if (!multipleEmailsInput.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const parsed = multipleEmailsInput
        .split(/[,;\s]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.includes('@'));

      if (parsed.length === 0) {
        setError('No valid email addresses found in input.');
        setSaving(false);
        return;
      }

      const updatedCompanies = [...(currentLead.currentCompanies ?? [])];
      if (emailItem.companyIndex !== -1 && updatedCompanies[emailItem.companyIndex]) {
        const existing = updatedCompanies[emailItem.companyIndex].companyEmails ?? [];
        updatedCompanies[emailItem.companyIndex].companyEmails = Array.from(new Set([...existing, ...parsed]));
      }

      const res = await updateLeadDetailsApi(emailItem.leadId, {
        ...(emailItem.companyIndex !== -1
          ? { currentCompanies: updatedCompanies, verifyCompanyEmails: parsed }
          : { addManualEmail: parsed.join(','), discoveredEmails: Array.from(new Set([...(currentLead.discoveredEmails ?? []), ...parsed])) }),
      });

      setCurrentLead(res.result);
      onLeadUpdated(res.result);

      if (!targetEmailInput && parsed[0]) {
        setTargetEmailInput(parsed[0]);
      }
      setMultipleEmailsInput('');
      setSuccessMsg(`✓ Added & SMTP-verified ${parsed.length} email address(es)!`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add emails');
    } finally {
      setSaving(false);
    }
  };

  const handleCopyAll = async () => {
    try {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = bodyHtmlInput;
      const textBody = tempDiv.innerText || tempDiv.textContent || '';
      const fullText = `Subject: ${subjectInput}\n\n${textBody}`;
      await navigator.clipboard.writeText(fullText);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1500);
    } catch { /* ignore */ }
  };

  const handleToggleModalApprove = () => {
    setError(null);
    if (!isApproved) {
      if (!targetEmailInput.trim() || targetStatus !== 'valid') {
        setError('Cannot approve draft! Target contact email must be selected and SMTP verified as valid before approval.');
        return;
      }
    }
    setIsApproved(!isApproved);
  };

  const handleSaveModalEdits = async () => {
    setSaving(true);
    setError(null);
    try {
      if (isApproved && (!targetEmailInput.trim() || targetStatus !== 'valid')) {
        setError('Cannot approve draft! Target contact email must be selected and SMTP verified as valid before approval.');
        setSaving(false);
        return;
      }

      const companies = [...(currentLead.currentCompanies ?? [])];

      if (emailItem.companyIndex !== -1 && companies[emailItem.companyIndex]) {
        companies[emailItem.companyIndex].emailSubject = subjectInput;
        companies[emailItem.companyIndex].emailBody = bodyHtmlInput;
        companies[emailItem.companyIndex].approved = isApproved;

        if (targetEmailInput.trim()) {
          const cleanEmail = targetEmailInput.trim().toLowerCase();
          const compEmails = companies[emailItem.companyIndex].companyEmails ?? [];
          if (!compEmails.includes(cleanEmail)) {
            companies[emailItem.companyIndex].companyEmails = [cleanEmail, ...compEmails];
          }
        }
      }

      const res = await updateLeadDetailsApi(emailItem.leadId, {
        ...(emailItem.companyIndex !== -1
          ? {
              currentCompanies: companies,
              emailSubject: companies[0]?.emailSubject ?? subjectInput,
              emailBody: companies[0]?.emailBody ?? bodyHtmlInput,
              approved: companies[0]?.approved ?? isApproved,
              ...(targetEmailInput.trim() ? { verifyCompanyEmails: [targetEmailInput.trim()] } : {}),
            }
          : {
              emailSubject: subjectInput,
              emailBody: bodyHtmlInput,
              approved: isApproved,
              ...(targetEmailInput.trim() ? { forceVerifyEmail: targetEmailInput.trim() } : {}),
            }),
      });

      onLeadUpdated(res.result);
      onClose();
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
      const response = await refineLeadEmailApi(emailItem.leadId, promptText);
      onLeadUpdated(response.result);
      setSubjectInput(response.result.emailSubject || subjectInput);
      setBodyHtmlInput(response.result.emailBody || bodyHtmlInput);
      setRefinePrompt('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI refinement failed');
    } finally {
      setRefining(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-3xl rounded-xl bg-white p-6 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto border border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <div>
            <h3 className="text-lg font-extrabold text-slate-900 leading-snug">
              {emailItem.candidateName || 'Candidate Profile'}
            </h3>
            <div className="flex items-center gap-2 mt-1 flex-wrap text-xs">
              <span className="font-mono text-indigo-600 font-extrabold text-xs">
                {getDbSerialNumber(emailItem.clientName)}
              </span>
              {emailItem.companyIndex === -1 ? (
                <span className="font-extrabold text-blue-800 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded whitespace-nowrap shrink-0">
                  👤 Personal Profile
                </span>
              ) : (
                <span className="font-extrabold text-purple-800 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded">
                  🏢 {emailItem.companyName}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <XIcon width={18} height={18} />
          </button>
        </div>

        {/* Notifications */}
        {error && (
          <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 font-semibold">
            <AlertTriangleIcon width={14} height={14} className="shrink-0 text-red-600" />
            <div className="flex-1">{error}</div>
          </div>
        )}
        {successMsg && (
          <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-xs text-green-700 font-semibold">
            <CheckCircleIcon width={14} height={14} className="shrink-0 text-green-600" />
            <div className="flex-1">{successMsg}</div>
          </div>
        )}

        <div className="space-y-4 text-xs">
          {/* ── 0. CLIENT SUMMARY FROM DATABASE (As shown in Client Detail Page) ── */}
          {(() => {
            const mainSummary = currentLead.summary?.trim();
            const targetComp = emailItem.companyIndex >= 0 ? currentLead.currentCompanies?.[emailItem.companyIndex] : null;
            const roleSummary = targetComp?.summary?.trim();
            const jobTitle = targetComp?.jobTitle?.trim() || emailItem.jobTitle;

            if (!mainSummary && !roleSummary && !jobTitle) return null;

            return (
              <div className="bg-gradient-to-r from-slate-50 to-indigo-50/40 border border-indigo-200/80 rounded-lg p-3.5 space-y-2.5 shadow-2xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-extrabold text-indigo-900 uppercase tracking-wider flex items-center gap-1.5">
                    <SparklesIcon width={12} height={12} className="text-indigo-600" />
                    Client Intelligence & Database Summary
                  </span>
                  {jobTitle && (
                    <span className="text-[11px] font-bold text-slate-700 bg-white border border-slate-200 px-2 py-0.5 rounded shadow-2xs">
                      {jobTitle}
                    </span>
                  )}
                </div>

                {mainSummary && (
                  <p className="text-xs text-slate-700 font-medium leading-relaxed bg-white/90 border border-slate-200/80 rounded-md p-2.5">
                    {mainSummary}
                  </p>
                )}

                {roleSummary && (
                  <div className="text-xs text-slate-700 bg-white/90 border border-indigo-100 rounded-md p-2.5">
                    <span className="font-extrabold text-indigo-900 block mb-0.5">
                      Role Summary ({emailItem.companyName}):
                    </span>
                    <p className="leading-relaxed">{roleSummary}</p>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── 1. DIRECT WEB CRAWLING IN MODAL ────────────────────────────── */}
          <div className="bg-purple-50/50 border border-purple-200 rounded-lg p-3 space-y-2">
            <label className="text-[10px] font-extrabold text-purple-900 uppercase tracking-wider flex items-center gap-1.5">
              <GlobeIcon width={12} height={12} className="text-purple-600" />
              Direct Website Crawling & Email Extraction
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Enter company website URL (e.g. https://acme.com)..."
                value={websiteUrlInput}
                onChange={(e) => setWebsiteUrlInput(e.target.value)}
                disabled={crawling}
                className="flex-1 text-xs border border-purple-200 rounded px-3 py-1.5 focus:ring-1 focus:ring-purple-500 focus:outline-none bg-white font-mono"
              />
              <Button
                type="button"
                size="sm"
                onClick={() => { void handleCrawlWebsiteInModal(); }}
                disabled={crawling || !websiteUrlInput.trim()}
                className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-3 py-1.5 font-bold shrink-0 flex items-center gap-1 disabled:opacity-50"
              >
                {crawling ? (
                  <>
                    <LoaderIcon width={11} height={11} className="animate-spin" />
                    Crawling...
                  </>
                ) : (
                  <>
                    <RefreshIcon width={11} height={11} />
                    ⚡ Crawl & Extract Emails
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* ── 2. CONTACT EMAILS & INLINE SMTP VERIFICATION ───────────────── */}
          <div className="border border-slate-200 rounded-lg p-3.5 space-y-3 bg-slate-50/50">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Target Contact Emails ({availableEmails.length} Discovered)
              </label>
              {targetEmailInput ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold text-slate-500">Selected Target:</span>
                  <span className="font-mono font-bold text-indigo-700 bg-white px-2 py-0.5 rounded border border-indigo-200">
                    {targetEmailInput}
                  </span>
                  <SmtpBadge status={targetStatus ?? 'pending'} />
                </div>
              ) : (
                <Badge tone="warning">⚠️ No Email Selected</Badge>
              )}
            </div>

            {/* Email Radio List with Inline SMTP Verify Buttons */}
            {availableEmails.length > 0 ? (
              <div className="space-y-1.5 bg-white border border-slate-200 rounded-md p-2 max-h-36 overflow-y-auto">
                {availableEmails.map((em) => {
                  const status = verifiedMap.get(em.toLowerCase()) ?? 'pending';
                  const isSelected = targetEmailInput.toLowerCase() === em.toLowerCase();
                  const isVerifying = verifyingEmail === em;

                  return (
                    <div
                      key={em}
                      onClick={() => setTargetEmailInput(em)}
                      className={[
                        'flex items-center justify-between p-2 rounded-md border text-xs cursor-pointer transition-all',
                        isSelected ? 'bg-indigo-50/80 border-indigo-300 font-bold' : 'border-slate-100 hover:bg-slate-50',
                      ].join(' ')}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="targetEmailSelection"
                          checked={isSelected}
                          onChange={() => setTargetEmailInput(em)}
                          className="text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                        <span className="font-mono text-slate-900">{em}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <SmtpBadge status={status} />
                        <button
                          type="button"
                          disabled={isVerifying}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleVerifyEmailInModal(em);
                          }}
                          className="flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded hover:bg-amber-100 transition-colors disabled:opacity-50"
                        >
                          {isVerifying ? (
                            <>
                              <LoaderIcon width={10} height={10} className="animate-spin text-amber-600" />
                              Verifying...
                            </>
                          ) : (
                            <>⚡ Verify SMTP</>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-md p-2.5 text-xs text-amber-800 font-semibold italic flex items-center justify-between">
                <span>No contact emails discovered yet for this entry.</span>
                <Badge tone="warning">⚠️ No Email Found</Badge>
              </div>
            )}

            {/* Add Multiple Emails Input Field */}
            <div className="pt-2 border-t border-slate-200/80 space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                Add Multiple Emails directly (Comma / Space Separated)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. contact@company.com, sales@company.com"
                  value={multipleEmailsInput}
                  onChange={(e) => setMultipleEmailsInput(e.target.value)}
                  disabled={saving}
                  className="flex-1 text-xs font-mono border border-slate-300 rounded px-3 py-1.5 focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => { void handleAddMultipleEmails(); }}
                  disabled={saving || !multipleEmailsInput.trim()}
                  className="border-indigo-200 text-indigo-700 hover:bg-indigo-50 text-xs px-3 py-1.5 font-bold flex items-center gap-1 shrink-0"
                >
                  <PlusCircleIcon width={12} height={12} />
                  + Add & Verify SMTP
                </Button>
              </div>
            </div>
          </div>

          {/* Subject Line */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              Subject Line
            </label>
            <input
              type="text"
              value={subjectInput}
              onChange={(e) => setSubjectInput(e.target.value)}
              className="w-full text-xs font-bold text-slate-900 border border-slate-300 rounded px-3 py-2 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            />
          </div>

          {/* WYSIWYG Editor */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              Email HTML Body (WYSIWYG Editor)
            </label>
            <RichTextEditor initialValue={bodyHtmlInput} onChange={setBodyHtmlInput} />
          </div>

          {/* AI Refinement */}
          <div className="bg-indigo-50/50 border border-indigo-100 rounded-md p-3 space-y-2">
            <label className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider block">
              AI Refinement Instruction
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g. Make email tone more casual"
                value={refinePrompt}
                onChange={(e) => setRefinePrompt(e.target.value)}
                className="flex-1 text-xs border border-slate-200 rounded px-3 py-1.5 focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => { void handleImproveWithAi(); }}
                disabled={refining || !refinePrompt.trim()}
                className="text-indigo-600 border-indigo-200 hover:bg-indigo-100 flex items-center gap-1 text-xs shrink-0"
              >
                {refining ? <LoaderIcon width={11} height={11} className="animate-spin" /> : <SparklesIcon width={11} height={11} />}
                Improve with AI
              </Button>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-slate-200 pt-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleToggleModalApprove}
              className={[
                'text-xs px-3 py-1.5 rounded-full font-bold border transition-all',
                isApproved
                  ? 'bg-green-600 text-white border-green-600'
                  : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200',
              ].join(' ')}
            >
              {isApproved ? '✓ Approved' : 'Mark as Approved'}
            </button>

            <button
              type="button"
              onClick={() => { void handleCopyAll(); }}
              className="flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
            >
              {copiedAll ? <CheckCircleIcon width={12} height={12} /> : <CopyIcon width={12} height={12} />}
              {copiedAll ? 'Copied Full!' : 'Copy Email'}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={() => { void handleSaveModalEdits(); }} disabled={saving} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold">
              {saving ? <LoaderIcon width={13} height={13} className="animate-spin" /> : <CheckCircleIcon width={13} height={13} />}
              Save & Update Email
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Compact Email Card ────────────────────────────────────────────────────────

function getDbSerialNumber(clientName?: string | null, fallbackIndex?: number): string {
  if (clientName) {
    const match = clientName.match(/#\d+/);
    if (match) return `id -${match[0]}`;
  }
  return fallbackIndex ? `id -#${fallbackIndex}` : 'id -#1';
}

function CompactEmailCard({
  emailItem,
  leadDoc,
  itemNumber,
  onLeadUpdated,
}: {
  emailItem: GeneratedEmailItem;
  leadDoc: LeadIngestionRecord;
  itemNumber?: number;
  onLeadUpdated: (updated: LeadIngestionRecord) => void;
}) {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);

  const handleToggleApproval = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setCardError(null);

    if (!emailItem.approved) {
      if (!emailItem.targetEmail || emailItem.emailStatus !== 'valid') {
        setCardError('Cannot approve draft! Target contact email must be entered and SMTP verified as valid before approval.');
        setTimeout(() => setCardError(null), 4000);
        return;
      }
    }

    try {
      const companies = [...(leadDoc.currentCompanies ?? [])];
      if (companies[emailItem.companyIndex]) {
        companies[emailItem.companyIndex].approved = !emailItem.approved;
      }

      const res = await updateLeadDetailsApi(emailItem.leadId, {
        currentCompanies: companies,
        approved: companies[0]?.approved ?? !emailItem.approved,
      });
      onLeadUpdated(res.result);
    } catch { /* ignore */ }
  };

  return (
    <>
      <Card className="border border-slate-200 shadow-2xs hover:shadow-md transition-all bg-white flex flex-col justify-between overflow-hidden">
        <CardHeader
          title={
            <div className="flex items-start justify-between gap-3 w-full">
              <div className="min-w-0 flex-1 space-y-1">
                {/* Candidate Name (Line-clamped for long names) */}
                <div className="text-sm font-extrabold text-slate-900 leading-snug line-clamp-2">
                  {emailItem.candidateName || 'Candidate Profile'}
                </div>

                {/* Subtitle: DB Serial Number (e.g. #17) */}
                <div className="text-[11px] font-mono font-extrabold text-indigo-600">
                  {getDbSerialNumber(emailItem.clientName, itemNumber)}
                </div>

                {/* Dedicated Profile Type Badge Row */}
                <div className="pt-0.5">
                  {emailItem.companyIndex === -1 ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-extrabold text-blue-800 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full whitespace-nowrap shrink-0">
                      👤 Personal Profile
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-extrabold text-purple-800 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-full truncate max-w-full">
                      🏢 {emailItem.companyName}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {!emailItem.targetEmail ? (
                  <Badge tone="warning">⚠️ No Email Found</Badge>
                ) : emailItem.emailStatus === 'valid' || emailItem.emailStatus === 'risky' ? (
                  <Badge tone="success">✓ SMTP Verified</Badge>
                ) : emailItem.emailStatus === 'invalid' ? (
                  <Badge tone="danger">❌ Email Not Exist</Badge>
                ) : (
                  <Badge tone="warning">⚡ SMTP Not Verified</Badge>
                )}
                <button
                  type="button"
                  onClick={handleToggleApproval}
                  className={[
                    'text-[10px] px-2.5 py-0.5 rounded-full font-bold border transition-all shrink-0',
                    emailItem.approved
                      ? 'bg-green-600 text-white border-green-600'
                      : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200',
                  ].join(' ')}
                >
                  {emailItem.approved ? '✓ Approved' : 'Draft'}
                </button>
              </div>
            </div>
          }
        />

        <CardContent className="pt-2 space-y-3 flex-1 flex flex-col justify-between">
          {cardError && (
            <div className="text-[11px] font-semibold text-red-600 bg-red-50 p-2 rounded border border-red-200">
              {cardError}
            </div>
          )}

          <div className="space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Contact Email</span>
            {emailItem.targetEmail ? (
              <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5 gap-1">
                <span className="text-[11px] font-mono font-bold text-slate-800 truncate">{emailItem.targetEmail}</span>
                <SmtpBadge status={emailItem.emailStatus} />
              </div>
            ) : (
              <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5 gap-1">
                <span className="text-[11px] font-semibold text-amber-800 italic">No contact email assigned</span>
                <Badge tone="warning">⚠️ No Email Found</Badge>
              </div>
            )}
          </div>

          <div className="space-y-1 bg-white border border-slate-100 p-2.5 rounded-md">
            <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider flex items-center gap-1">
              <SparklesIcon width={10} height={10} /> Subject Preview
            </span>
            <p className="text-xs font-semibold text-slate-800 line-clamp-1 truncate">
              {emailItem.subject}
            </p>
          </div>

          <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 mt-auto">
            <div className="flex items-center gap-1.5">
              <SendStatusBadge status={emailItem.sendStatus} />
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowModal(true)}
                className="text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded flex items-center gap-1 transition-colors"
              >
                <EditIcon width={11} height={11} /> View / Edit Email
              </button>

              <button
                type="button"
                onClick={() => router.push(`/lead-ingestion/client/${emailItem.leadId}`)}
                className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 p-1"
                title="View Client Workspace"
              >
                <ExternalLinkIcon width={12} height={12} />
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {showModal && (
        <EmailEditModal
          emailItem={emailItem}
          leadDoc={leadDoc}
          onClose={() => setShowModal(false)}
          onLeadUpdated={onLeadUpdated}
        />
      )}
    </>
  );
}

// ── Main Page Component ───────────────────────────────────────────────────────

export default function OutreachEmailsPage() {
  const [leads, setLeads] = useState<LeadIngestionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchingMore, setFetchingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Server-Side & Local Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClientId, setSelectedClientId] = useState<string>('all');
  const [approvalFilter, setApprovalFilter] = useState<'approved' | 'draft' | 'all'>('draft');
  const [sendStatusFilter, setSendStatusFilter] = useState<'all' | 'no_contact_email' | 'pending' | 'in_progress' | 'delivered' | 'opened' | 'failed'>('all');
  const [smtpFilter, setSmtpFilter] = useState<'all' | 'valid' | 'unverified' | 'invalid' | 'no_contact_email'>('valid');

  // Server-Side Pagination State
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const observerRef = useRef<HTMLDivElement | null>(null);

  // True Server-side Fetch function querying /api/leads with all filter params
  const fetchServerLeads = async (
    targetPage: number,
    isInitial = false
  ) => {
    if (isInitial) setLoading(true);
    else setFetchingMore(true);
    setError(null);

    try {
      const approvedParam = approvalFilter === 'approved' ? 'true' : approvalFilter === 'draft' ? 'false' : 'all';
      const effectiveEmailStatus = sendStatusFilter !== 'all' ? sendStatusFilter : smtpFilter !== 'all' ? smtpFilter : 'all';

      const params = new URLSearchParams({
        page: targetPage.toString(),
        limit: '12',
        approved: approvedParam,
        emailStatus: effectiveEmailStatus,
        clientId: selectedClientId,
        ...(searchQuery.trim() ? { search: searchQuery.trim() } : {}),
      });

      const res = await fetch(`/api/leads?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch server leads');

      const data = (await res.json()) as {
        leads?: LeadIngestionRecord[];
        hasMore?: boolean;
      };

      const fetchedLeads = data.leads ?? [];

      if (isInitial) {
        setLeads(fetchedLeads);
      } else {
        setLeads((prev) => [...prev, ...fetchedLeads]);
      }

      setHasMore(!!data.hasMore);
      setPage(targetPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Server filtration failed');
    } finally {
      setLoading(false);
      setFetchingMore(false);
    }
  };

  // Re-fetch on filter / search changes (Debounced for search)
  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchServerLeads(1, true);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, selectedClientId, approvalFilter, sendStatusFilter, smtpFilter]);

  // Infinite Scroll Trigger
  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const target = entries[0];
      if (target.isIntersecting && hasMore && !fetchingMore && !loading) {
        void fetchServerLeads(page + 1, false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasMore, fetchingMore, loading, page]
  );

  useEffect(() => {
    const option = { root: null, rootMargin: '20px', threshold: 1.0 };
    const observer = new IntersectionObserver(handleObserver, option);
    if (observerRef.current) observer.observe(observerRef.current);
    return () => observer.disconnect();
  }, [handleObserver]);



  const handleLeadUpdated = (updated: LeadIngestionRecord) => {
    setLeads((prev) => prev.map((item) => (item._id === updated._id ? updated : item)));
  };

  // Flatten generated emails from server lead records
  const allGeneratedEmailItems: Array<{ item: GeneratedEmailItem; leadDoc: LeadIngestionRecord }> = [];

  leads.forEach((lead) => {
    const verifiedMap = new Map<string, VerifiedEmailItem['status']>();
    (lead.verifiedEmails ?? []).forEach((v) => verifiedMap.set(v.email, v.status));

    const companies = lead.currentCompanies ?? [];

    // 1. Render all Company-specific Drafts
    companies.forEach((comp, idx) => {
      if (comp.emailSubject && comp.emailBody) {
        const compEmails = comp.companyEmails ?? [];
        const targetEm = compEmails[0] ?? '';
        const status = targetEm ? (verifiedMap.get(targetEm) ?? 'pending') : 'pending';
        const computedSendStatus: GeneratedEmailItem['sendStatus'] = !targetEm.trim()
          ? 'no_contact_email'
          : (lead.emailStatus as GeneratedEmailItem['sendStatus']) ?? 'pending';

        allGeneratedEmailItems.push({
          item: {
            id: `${lead._id}-comp-${idx}`,
            leadId: lead._id,
            clientId: lead.clientId,
            candidateName: lead.fullName || 'Candidate Profile',
            clientName: (lead as unknown as { clientName?: string }).clientName || 'Client Profile',
            linkedinUrl: (lead as unknown as { linkedinUrl?: string }).linkedinUrl || null,
            companyName: comp.companyName,
            jobTitle: comp.jobTitle,
            targetEmail: targetEm,
            emailStatus: status,
            subject: comp.emailSubject,
            bodyHtml: comp.emailBody,
            approved: comp.approved ?? false,
            sendStatus: computedSendStatus,
            companyIndex: idx,
          },
          leadDoc: lead,
        });
      }
    });

    // 2. Render Personal / Primary Draft (always rendered if subject & body exist)
    if (lead.emailSubject && lead.emailBody) {
      const targetEm = lead.email ?? '';
      const status = targetEm ? (verifiedMap.get(targetEm) ?? lead.emailValidationStatus ?? 'pending') : 'pending';
      const computedSendStatus: GeneratedEmailItem['sendStatus'] = !targetEm.trim()
        ? 'no_contact_email'
        : (lead.emailStatus as GeneratedEmailItem['sendStatus']) ?? 'pending';

      allGeneratedEmailItems.push({
        item: {
          id: `${lead._id}-personal`,
          leadId: lead._id,
          clientId: lead.clientId,
          candidateName: lead.fullName || 'Candidate Profile',
          clientName: (lead as unknown as { clientName?: string }).clientName || 'Client Profile',
          linkedinUrl: (lead as unknown as { linkedinUrl?: string }).linkedinUrl || null,
          companyName: lead.companyName || 'Personal / Direct Email',
          jobTitle: lead.jobTitle || 'Personal Contact',
          targetEmail: targetEm,
          emailStatus: status,
          subject: lead.emailSubject,
          bodyHtml: lead.emailBody,
          approved: lead.approved ?? false,
          sendStatus: computedSendStatus,
          companyIndex: -1, // -1 denotes root personal draft
        },
        leadDoc: lead,
      });
    }
  });

  const filteredGeneratedEmailItems = allGeneratedEmailItems.filter(({ item }) => {
    if (smtpFilter === 'all') return true;
    if (smtpFilter === 'no_contact_email') return !item.targetEmail;
    if (smtpFilter === 'valid') return Boolean(item.targetEmail && item.emailStatus === 'valid');
    if (smtpFilter === 'unverified') return Boolean(item.targetEmail && item.emailStatus !== 'valid' && item.emailStatus !== 'invalid');
    if (smtpFilter === 'invalid') return Boolean(item.targetEmail && item.emailStatus === 'invalid');
    return true;
  });

  const countApprovedPendingSend = filteredGeneratedEmailItems.filter(
    ({ item }) => item.approved && (item.sendStatus === 'pending' || item.sendStatus === 'failed')
  ).length;

  return (
    <div className="w-full max-w-none px-4 sm:px-8 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeader
          title="Generated Outreach Emails Dashboard"
          description="Review, edit, and approve AI-generated outreach drafts for each candidate and company."
        />
      </div>

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

      {/* True Server-Side & Local Filters Bar */}
      <Card className="border border-slate-200 bg-white shadow-2xs">
        <CardContent className="py-3.5 px-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-4 flex-1">
              {/* Server Search Input */}
              <input
                type="text"
                placeholder="Search candidate, company, email, or LinkedIn URL..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="text-xs border border-slate-200 rounded-md px-3 py-2 focus:ring-1 focus:ring-indigo-500 focus:outline-none w-72 bg-white"
              />

              {/* Custom Searchable Client Selector */}
              <div className="flex items-center gap-1.5 text-xs text-slate-500 font-semibold">
                <span>Client:</span>
                <SearchableClientSelect
                  selectedClientId={selectedClientId}
                  onSelectClient={(id) => setSelectedClientId(id)}
                />
              </div>

              {/* Custom Styled Vertical Approval Filter */}
              <div className="flex items-center gap-1.5 text-xs text-slate-500 font-semibold">
                <span>Approval:</span>
                <CustomSelect<'approved' | 'draft' | 'all'>
                  value={approvalFilter}
                  options={[
                    { value: 'all', label: 'All Statuses (Default)' },
                    { value: 'approved', label: 'Approved Only' },
                    { value: 'draft', label: 'Drafts Only' },
                  ]}
                  onChange={setApprovalFilter}
                  widthClass="w-44"
                />
              </div>

              {/* Custom Styled Vertical SMTP Verification Filter */}
              <div className="flex items-center gap-1.5 text-xs text-slate-500 font-semibold">
                <span>SMTP Status:</span>
                <CustomSelect<'all' | 'valid' | 'unverified' | 'invalid' | 'no_contact_email'>
                  value={smtpFilter}
                  options={[
                    { value: 'all', label: 'All SMTP Statuses' },
                    { value: 'valid', label: '✓ Verified SMTP' },
                    { value: 'unverified', label: '⚡ SMTP Not Verified' },
                    { value: 'invalid', label: '❌ Invalid / Email Not Exist' },
                    { value: 'no_contact_email', label: '⚠️ No Contact Email' },
                  ]}
                  onChange={setSmtpFilter}
                  widthClass="w-52"
                />
              </div>

              {/* Custom Styled Vertical Send Status Filter */}
              <div className="flex items-center gap-1.5 text-xs text-slate-500 font-semibold">
                <span>Send Status:</span>
                <CustomSelect<'all' | 'no_contact_email' | 'pending' | 'in_progress' | 'delivered' | 'opened' | 'failed'>
                  value={sendStatusFilter}
                  options={[
                    { value: 'all', label: 'All Statuses' },
                    { value: 'no_contact_email', label: '⚠️ No Contact Email' },
                    { value: 'pending', label: 'Pending' },
                    { value: 'in_progress', label: 'In Progress' },
                    { value: 'delivered', label: 'Delivered' },
                    { value: 'opened', label: 'Opened' },
                    { value: 'failed', label: 'Failed' },
                  ]}
                  onChange={setSendStatusFilter}
                  widthClass="w-48"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Server Cards Grid with Infinite Scroll */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <LoaderIcon width={28} height={28} className="text-indigo-600 animate-spin" />
          <span className="text-sm font-semibold text-slate-500">Querying MongoDB server for outreach emails...</span>
        </div>
      ) : filteredGeneratedEmailItems.length === 0 ? (
        <Card className="py-12 border-dashed border-2 border-slate-200 flex flex-col items-center justify-center text-slate-400">
          <SparklesIcon width={36} height={36} className="text-slate-300 mb-2" />
          <div className="text-sm font-semibold text-slate-500 mb-1">No outreach emails found matching filter query.</div>
          <div className="text-xs text-slate-400">Try changing your server filter dropdowns or search query above.</div>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredGeneratedEmailItems.map(({ item, leadDoc }, idx) => (
              <CompactEmailCard
                key={item.id}
                itemNumber={idx + 1}
                emailItem={item}
                leadDoc={leadDoc}
                onLeadUpdated={handleLeadUpdated}
              />
            ))}
          </div>

          {/* Infinite Scroll Trigger element */}
          {hasMore && (
            <div ref={observerRef} className="flex justify-center py-6">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 bg-white border border-slate-200 px-4 py-2 rounded-full shadow-2xs">
                <LoaderIcon width={16} height={16} className="animate-spin text-indigo-600" />
                Loading next page of server outreach emails...
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
