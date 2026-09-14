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

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email.trim().toLowerCase());
}

function checkApprovalEligibility(
  availableEmails: string[],
  verifiedMap: Map<string, VerifiedEmailItem['status']>
): { ok: boolean; error?: string } {
  if (availableEmails.length === 0) {
    return {
      ok: false,
      error: 'Cannot approve draft! No contact emails found. Please add at least one email with verified SMTP.',
    };
  }

  const problematicEmails = availableEmails.filter((em) => {
    const s = verifiedMap.get(em.toLowerCase());
    return s !== 'valid' && s !== 'risky';
  });

  if (problematicEmails.length > 0) {
    return {
      ok: false,
      error: `Cannot approve draft! Unverified or invalid email(s) found in contact list (${problematicEmails.join(', ')}). Please verify SMTP or delete unverified/invalid email(s) first before approving.`,
    };
  }

  return { ok: true };
}

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
  readOnly = false,
}: {
  initialValue: string;
  onChange: (html: string) => void;
  readOnly?: boolean;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const isTypingRef = useRef(false);

  useEffect(() => {
    if (editorRef.current && !isTypingRef.current) {
      if (editorRef.current.innerHTML !== initialValue) {
        editorRef.current.innerHTML = initialValue || '';
      }
    }
  }, [initialValue]);

  const handleInput = () => {
    if (readOnly || !editorRef.current) return;
    isTypingRef.current = true;
    const html = editorRef.current.innerHTML;
    onChange(html);
    setTimeout(() => {
      isTypingRef.current = false;
    }, 100);
  };

  const executeCmd = (command: string, value = '') => {
    if (readOnly || !editorRef.current) return;
    editorRef.current.focus();
    document.execCommand(command, false, value);
    handleInput();
  };

  return (
    <div className={`border rounded-md overflow-hidden transition-colors ${readOnly ? 'border-slate-200 bg-slate-50' : 'border-slate-300 focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500 bg-white'}`}>
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-1 bg-slate-50 border-b border-slate-200 px-3 py-2 text-xs select-none">
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
      )}

      <div
        ref={editorRef}
        contentEditable={!readOnly}
        suppressContentEditableWarning
        onInput={handleInput}
        onBlur={() => {
          isTypingRef.current = false;
        }}
        className={`min-h-[180px] p-4 text-sm leading-relaxed focus:outline-none ${
          readOnly ? 'bg-slate-50 text-slate-600 cursor-not-allowed select-text' : 'bg-white text-slate-800'
        }`}
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
  const [isAddingEmail, setIsAddingEmail] = useState(false);
  const [addingEmailValue, setAddingEmailValue] = useState('');
  const [editingEmailKey, setEditingEmailKey] = useState<string | null>(null);
  const [editingEmailValue, setEditingEmailValue] = useState('');
  const [subjectInput, setSubjectInput] = useState(emailItem.subject);
  const [bodyHtmlInput, setBodyHtmlInput] = useState(emailItem.bodyHtml);
  const [isApproved, setIsApproved] = useState(emailItem.approved);
  const [refinePrompt, setRefinePrompt] = useState('');

  // Toast Notification State inside Modal Window
  const [toasts, setToasts] = useState<Array<{ id: string; type: 'success' | 'error' | 'info'; message: string }>>([]);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const toastId = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id: toastId, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toastId));
    }, 4000);
  };

  const removeToast = (toastId: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== toastId));
  };

  // Check if email has entered campaign sending execution (once in campaign, cannot return to draft)
  const isInCampaign = emailItem.sendStatus !== 'pending' && emailItem.sendStatus !== 'no_contact_email';

  // Web Crawling state inside modal
  const compObj = currentLead.currentCompanies?.[emailItem.companyIndex];
  const initialWebUrl = emailItem.companyIndex === -1
    ? (currentLead.portfolioUrl || currentLead.websiteUrl || '')
    : (compObj?.websiteUrl || currentLead.websiteUrl || '');
  const [websiteUrlInput, setWebsiteUrlInput] = useState(initialWebUrl);
  const [isEditingWebUrl, setIsEditingWebUrl] = useState(false);
  const [crawling, setCrawling] = useState(false);
  const [verifyingEmail, setVerifyingEmail] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [refining, setRefining] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);

  const verifiedMap = new Map<string, VerifiedEmailItem['status']>();
  (currentLead.verifiedEmails ?? []).forEach((v) => verifiedMap.set(v.email, v.status));

  // Determine current list of emails for this specific box (Personal or Target Company)
  const availableEmails: string[] = Array.from(new Set(
    emailItem.companyIndex === -1
      ? (currentLead.discoveredEmails ?? (currentLead.email ? [currentLead.email] : []))
      : (compObj?.companyEmails ?? [])
  ));

  // Handler: Crawl Website directly inside Modal
  const handleCrawlWebsiteInModal = async () => {
    if (!websiteUrlInput.trim() || isApproved) return;
    setCrawling(true);
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
      setIsEditingWebUrl(false);

      const freshComp = crawlRes.result.currentCompanies?.[emailItem.companyIndex];
      const freshEmails = emailItem.companyIndex === -1
        ? (crawlRes.result.discoveredEmails ?? [])
        : (freshComp?.companyEmails ?? []);

      showToast(`✓ Extracted emails from ${websiteUrlInput.trim()}! Total: ${freshEmails.length} email(s).`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to crawl website', 'error');
    } finally {
      setCrawling(false);
    }
  };

  // Handler: Single Email SMTP Re-verify directly inside Modal
  const handleVerifyEmailInModal = async (emailToVerify: string) => {
    if (!emailToVerify.trim() || isApproved) return;
    setVerifyingEmail(emailToVerify);
    try {
      const res = await updateLeadDetailsApi(emailItem.leadId, {
        ...(emailItem.companyIndex === -1
          ? { forceVerifyEmail: emailToVerify.trim() }
          : { verifyCompanyEmails: [emailToVerify.trim()] }),
      });
      setCurrentLead(res.result);
      onLeadUpdated(res.result);
      showToast(`✓ SMTP verification completed for ${emailToVerify.trim()}`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'SMTP verification failed', 'error');
    } finally {
      setVerifyingEmail(null);
    }
  };

  // Handler: Delete email address directly inside Modal
  const handleDeleteEmailInModal = async (emailToDelete: string) => {
    if (isApproved) return;
    setSaving(true);
    try {
      const targetEmail = emailToDelete.toLowerCase().trim();
      const updatedCompanies = [...(currentLead.currentCompanies ?? [])];

      if (emailItem.companyIndex !== -1 && updatedCompanies[emailItem.companyIndex]) {
        const existing = updatedCompanies[emailItem.companyIndex].companyEmails ?? [];
        updatedCompanies[emailItem.companyIndex].companyEmails = existing.filter(
          (e) => e.toLowerCase() !== targetEmail
        );
      }

      const res = await updateLeadDetailsApi(emailItem.leadId, {
        ...(emailItem.companyIndex !== -1
          ? { currentCompanies: updatedCompanies }
          : {
              discoveredEmails: (currentLead.discoveredEmails ?? []).filter(
                (e) => e.toLowerCase() !== targetEmail
              ),
            }),
      });

      setCurrentLead(res.result);
      onLeadUpdated(res.result);
      showToast(`Deleted ${targetEmail}`, 'info');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete email', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Handler: Add New Email & Auto-Verify SMTP directly inside Modal
  const handleSaveAddEmail = async () => {
    const rawVal = addingEmailValue.trim().toLowerCase();
    if (isApproved || !rawVal) return;

    if (!isValidEmail(rawVal)) {
      showToast(`"${rawVal}" is not a valid email address! (e.g. name@domain.com)`, 'error');
      return;
    }

    setSaving(true);
    try {
      const updatedCompanies = [...(currentLead.currentCompanies ?? [])];
      if (emailItem.companyIndex !== -1 && updatedCompanies[emailItem.companyIndex]) {
        const existing = updatedCompanies[emailItem.companyIndex].companyEmails ?? [];
        updatedCompanies[emailItem.companyIndex].companyEmails = Array.from(
          new Set([...existing.filter((e) => e.toLowerCase() !== rawVal), rawVal])
        );
      }

      const res = await updateLeadDetailsApi(emailItem.leadId, {
        ...(emailItem.companyIndex !== -1
          ? { currentCompanies: updatedCompanies, verifyCompanyEmails: [rawVal] }
          : { addManualEmail: rawVal, discoveredEmails: Array.from(new Set([...(currentLead.discoveredEmails ?? []).filter((e) => e.toLowerCase() !== rawVal), rawVal])) }),
      });

      setCurrentLead(res.result);
      onLeadUpdated(res.result);
      setAddingEmailValue('');
      setIsAddingEmail(false);
      showToast(`Added ${rawVal}! Verifying SMTP...`, 'success');

      // Auto-verify SMTP for new email
      void handleVerifyEmailInModal(rawVal);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to add email', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Handler: Edit Email string & Auto Re-Verify SMTP directly inside Modal
  const handleSaveEditEmail = async (oldEmail: string) => {
    const newVal = editingEmailValue.trim().toLowerCase();
    const oldVal = oldEmail.trim().toLowerCase();
    if (isApproved || !newVal) return;

    if (!isValidEmail(newVal)) {
      showToast(`"${newVal}" is not a valid email address! (e.g. name@domain.com)`, 'error');
      return;
    }

    setSaving(true);
    try {
      const updatedCompanies = [...(currentLead.currentCompanies ?? [])];

      if (emailItem.companyIndex !== -1 && updatedCompanies[emailItem.companyIndex]) {
        const existing = updatedCompanies[emailItem.companyIndex].companyEmails ?? [];
        updatedCompanies[emailItem.companyIndex].companyEmails = existing.map((e) =>
          e.toLowerCase() === oldVal ? newVal : e
        );
      }

      const updatedDiscovered = (currentLead.discoveredEmails ?? []).map((e) =>
        e.toLowerCase() === oldVal ? newVal : e
      );

      const res = await updateLeadDetailsApi(emailItem.leadId, {
        ...(emailItem.companyIndex !== -1
          ? { currentCompanies: updatedCompanies, verifyCompanyEmails: [newVal] }
          : { discoveredEmails: updatedDiscovered, forceVerifyEmail: newVal }),
      });

      setCurrentLead(res.result);
      onLeadUpdated(res.result);
      setEditingEmailKey(null);
      setEditingEmailValue('');
      showToast(`Updated email to ${newVal}! Re-verifying SMTP...`, 'success');

      // Auto re-verify SMTP for edited email
      void handleVerifyEmailInModal(newVal);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to edit email', 'error');
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
      showToast('Copied full email subject & body to clipboard!', 'success');
      setTimeout(() => setCopiedAll(false), 1500);
    } catch {
      showToast('Failed to copy to clipboard', 'error');
    }
  };

  const handleToggleModalApprove = async () => {
    if (isInCampaign) {
      showToast('Cannot return to draft! This email is already in an active campaign flow.', 'error');
      return;
    }

    if (!isApproved) {
      const eligibility = checkApprovalEligibility(availableEmails, verifiedMap);
      if (!eligibility.ok) {
        showToast(eligibility.error!, 'error');
        return;
      }
    }

    const nextApproved = !isApproved;
    setSaving(true);
    try {
      const companies = [...(currentLead.currentCompanies ?? [])];
      if (emailItem.companyIndex !== -1 && companies[emailItem.companyIndex]) {
        companies[emailItem.companyIndex].approved = nextApproved;
      }

      const res = await updateLeadDetailsApi(emailItem.leadId, {
        ...(emailItem.companyIndex !== -1
          ? {
              currentCompanies: companies,
            }
          : {
              approved: nextApproved,
            }),
      });

      setCurrentLead(res.result);
      setIsApproved(nextApproved);
      onLeadUpdated(res.result);
      showToast(
        nextApproved ? '✓ Draft approved & saved to database!' : 'Draft status returned to unapproved in database',
        nextApproved ? 'success' : 'info'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update approval status', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveModalEdits = async () => {
    setSaving(true);
    try {
      if (isApproved) {
        const eligibility = checkApprovalEligibility(availableEmails, verifiedMap);
        if (!eligibility.ok) {
          showToast(eligibility.error!, 'error');
          setSaving(false);
          return;
        }
      }

      const companies = [...(currentLead.currentCompanies ?? [])];

      if (emailItem.companyIndex !== -1 && companies[emailItem.companyIndex]) {
        companies[emailItem.companyIndex].emailSubject = subjectInput;
        companies[emailItem.companyIndex].emailBody = bodyHtmlInput;
        companies[emailItem.companyIndex].approved = isApproved;
      }

      const res = await updateLeadDetailsApi(emailItem.leadId, {
        ...(emailItem.companyIndex !== -1
          ? {
              currentCompanies: companies,
            }
          : {
              emailSubject: subjectInput,
              emailBody: bodyHtmlInput,
              approved: isApproved,
            }),
      });

      onLeadUpdated(res.result);
      showToast('✓ Email saved & updated successfully!', 'success');
      setTimeout(() => onClose(), 600);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save changes', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleImproveWithAi = async () => {
    if (isApproved) return;
    const promptText = refinePrompt.trim();
    if (!promptText) return;
    setRefining(true);
    try {
      const response = await refineLeadEmailApi(emailItem.leadId, promptText, emailItem.companyIndex);
      onLeadUpdated(response.result);
      if (emailItem.companyIndex !== -1) {
        const updatedComp = response.result.currentCompanies?.[emailItem.companyIndex];
        setSubjectInput(updatedComp?.emailSubject || subjectInput);
        setBodyHtmlInput(updatedComp?.emailBody || bodyHtmlInput);
      } else {
        setSubjectInput(response.result.emailSubject || subjectInput);
        setBodyHtmlInput(response.result.emailBody || bodyHtmlInput);
      }
      setRefinePrompt('');
      showToast('✨ AI refined email content successfully!', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'AI refinement failed', 'error');
    } finally {
      setRefining(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs overflow-y-auto">
      {/* Floating Toast Notification Stack inside Modal */}
      {toasts.length > 0 && (
        <div className="fixed top-6 right-6 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={[
                'pointer-events-auto flex items-center justify-between p-3.5 rounded-lg border text-xs font-semibold shadow-2xl transition-all animate-in slide-in-from-top-2',
                t.type === 'success'
                  ? 'bg-slate-900 text-white border-emerald-500/50 shadow-emerald-950/20'
                  : t.type === 'error'
                  ? 'bg-slate-900 text-white border-red-500/50 shadow-red-950/20'
                  : 'bg-slate-900 text-white border-indigo-500/50 shadow-slate-950/20',
              ].join(' ')}
            >
              <div className="flex items-center gap-2">
                {t.type === 'success' && <CheckCircleIcon width={15} height={15} className="text-emerald-400 shrink-0" />}
                {t.type === 'error' && <AlertTriangleIcon width={15} height={15} className="text-red-400 shrink-0" />}
                {t.type === 'info' && <SparklesIcon width={15} height={15} className="text-indigo-400 shrink-0" />}
                <span className="leading-snug">{t.message}</span>
              </div>
              <button
                type="button"
                onClick={() => removeToast(t.id)}
                className="text-slate-400 hover:text-white p-0.5 ml-2 rounded transition-colors"
              >
                <XIcon width={12} height={12} />
              </button>
            </div>
          ))}
        </div>
      )}

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

        {/* Read-Only Approval Lock Banner */}
        {isApproved && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50/90 p-3 text-xs text-amber-900 font-semibold shadow-2xs">
            <div className="flex items-center gap-2">
              <span className="text-base">🔒</span>
              <div>
                <span className="font-extrabold">Draft Approved & Content Locked:</span> Email content and contacts are read-only.
                {isInCampaign
                  ? ' This email is currently in an active campaign and cannot be returned to draft.'
                  : ' Click "Return to Draft" to enable editing.'}
              </div>
            </div>
            {!isInCampaign && (
              <button
                type="button"
                onClick={() => setIsApproved(false)}
                className="text-[11px] font-bold bg-amber-200/80 hover:bg-amber-300/90 text-amber-950 px-2.5 py-1 rounded border border-amber-300 shrink-0 transition-colors"
              >
                Return to Draft
              </button>
            )}
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

          {/* ── 1. COMPACT WEBSITE CRAWLING ROW (Matching Clients Page) ────────────── */}
          <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-md px-3 py-1.5 text-xs gap-2">
            {crawling ? (
              <div className="flex items-center gap-2 text-purple-700 font-semibold animate-pulse py-0.5">
                <LoaderIcon width={13} height={13} className="animate-spin text-purple-600" />
                Crawling website & extracting email addresses...
              </div>
            ) : websiteUrlInput && !isEditingWebUrl ? (
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <GlobeIcon width={13} height={13} className="text-slate-500 shrink-0" />
                  <span className="text-[11px] font-bold text-slate-600 shrink-0">Website URL:</span>
                  <a
                    href={websiteUrlInput.startsWith('http') ? websiteUrlInput : `https://${websiteUrlInput}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 font-mono font-bold text-purple-700 hover:underline truncate"
                  >
                    {websiteUrlInput.replace(/^https?:\/\//, '').split('/')[0]}
                    <ExternalLinkIcon width={10} height={10} className="shrink-0" />
                  </a>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  <button
                    type="button"
                    disabled={isApproved || crawling}
                    onClick={() => { void handleCrawlWebsiteInModal(); }}
                    title="Recrawl Website & Extract Emails Again"
                    className="flex items-center gap-1 text-[11px] font-bold text-purple-700 bg-purple-50 border border-purple-200 hover:bg-purple-100 px-2 py-0.5 rounded transition-colors disabled:opacity-40"
                  >
                    <RefreshIcon width={11} height={11} /> ⚡ Recrawl
                  </button>

                  <button
                    type="button"
                    disabled={isApproved || crawling}
                    onClick={() => setIsEditingWebUrl(true)}
                    title="Edit Website URL"
                    className="text-slate-400 hover:text-purple-600 p-1 rounded hover:bg-purple-50 transition-colors disabled:opacity-30"
                  >
                    <EditIcon width={13} height={13} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between w-full gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <GlobeIcon width={13} height={13} className="text-slate-500 shrink-0" />
                  <span className="text-[11px] font-bold text-slate-600 shrink-0">Website URL:</span>
                  <input
                    type="url"
                    placeholder="Enter website URL (e.g. https://acme.com)..."
                    value={websiteUrlInput}
                    onChange={(e) => setWebsiteUrlInput(e.target.value)}
                    disabled={isApproved || crawling}
                    className="flex-1 text-xs font-mono border border-slate-200 rounded px-2.5 py-1 focus:ring-1 focus:ring-purple-500 focus:outline-none bg-white text-slate-800 disabled:opacity-50"
                  />
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => { void handleCrawlWebsiteInModal(); }}
                    disabled={isApproved || crawling || !websiteUrlInput.trim()}
                    className="bg-purple-600 hover:bg-purple-700 text-white text-[11px] px-2.5 py-1 font-bold flex items-center gap-1 disabled:opacity-50"
                  >
                    {crawling ? <LoaderIcon width={10} height={10} className="animate-spin" /> : <RefreshIcon width={10} height={10} />}
                    Save & Crawl
                  </Button>

                  {websiteUrlInput && (
                    <button
                      type="button"
                      disabled={crawling}
                      onClick={() => setIsEditingWebUrl(false)}
                      className="text-[10px] text-slate-400 hover:text-slate-600 px-1 disabled:opacity-30"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── 2. CONTACT EMAILS & INLINE SMTP VERIFICATION (Matching Clients Page) ── */}
          <div className="border border-slate-200 rounded-lg p-3.5 space-y-3 bg-slate-50/50">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <MailIcon width={12} height={12} className="text-slate-600" />
                Contact Emails ({availableEmails.length} Discovered)
              </label>

              {!isAddingEmail ? (
                <button
                  type="button"
                  disabled={isApproved}
                  onClick={() => {
                    setIsAddingEmail(true);
                    setAddingEmailValue('');
                  }}
                  className="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded hover:bg-blue-100 flex items-center gap-1 transition-colors disabled:opacity-40"
                >
                  <PlusCircleIcon width={11} height={11} /> + Add Email
                </button>
              ) : (
                <div className="text-[10px] font-semibold text-slate-500 italic">
                  Multiple sender addresses pool used during campaign dispatch
                </div>
              )}
            </div>

            {/* Email List with Inline Edit, Delete, & SMTP Verification */}
            {availableEmails.length > 0 ? (
              <div className="space-y-2 bg-white border border-slate-200 rounded-md p-2 max-h-56 overflow-y-auto">
                {availableEmails.map((em) => {
                  const status = verifiedMap.get(em.toLowerCase()) ?? 'pending';
                  const isVerifying = verifyingEmail === em;
                  const isEditingThis = editingEmailKey === em;

                  return (
                    <div
                      key={em}
                      className="flex flex-col bg-slate-50/50 border border-slate-200/80 rounded-md p-2 text-xs transition-all gap-1.5"
                    >
                      {isEditingThis ? (
                        <div className="flex flex-col gap-1.5 w-full">
                          <div className="flex items-center gap-2">
                            <input
                              type="email"
                              autoFocus
                              value={editingEmailValue}
                              onChange={(e) => setEditingEmailValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && isValidEmail(editingEmailValue)) {
                                  void handleSaveEditEmail(em);
                                }
                              }}
                              disabled={saving}
                              className={[
                                'flex-1 text-xs font-mono border rounded px-2.5 py-1 focus:ring-1 focus:outline-none bg-white disabled:opacity-50 transition-colors',
                                editingEmailValue.length > 0 && !isValidEmail(editingEmailValue)
                                  ? 'border-red-400 focus:ring-red-500 bg-red-50/40 text-red-900 font-semibold'
                                  : 'border-blue-300 focus:ring-blue-500 text-slate-900',
                              ].join(' ')}
                            />
                            <button
                              type="button"
                              disabled={saving || !isValidEmail(editingEmailValue)}
                              onClick={() => { void handleSaveEditEmail(em); }}
                              className="text-[11px] font-bold text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded hover:bg-green-100 flex items-center gap-1 disabled:opacity-40 transition-colors shrink-0"
                            >
                              {saving ? <LoaderIcon width={10} height={10} className="animate-spin" /> : '✓'} Save & Verify
                            </button>
                            <button
                              type="button"
                              onClick={() => { setEditingEmailKey(null); setEditingEmailValue(''); }}
                              className="text-[10px] font-semibold text-slate-400 hover:text-slate-600 px-1 shrink-0"
                            >
                              Cancel
                            </button>
                          </div>
                          {/* Zod-Style Error Helper for Edit */}
                          {editingEmailValue.length > 0 && !isValidEmail(editingEmailValue) && (
                            <p className="text-[11px] font-medium text-red-600 flex items-center gap-1 animate-in fade-in">
                              <AlertTriangleIcon width={12} height={12} className="shrink-0 text-red-500" />
                              Invalid email address (e.g. name@domain.com)
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2 w-full">
                          <span className="font-mono font-semibold text-slate-900 truncate flex-1">{em}</span>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <SmtpBadge status={status} />

                            <button
                              type="button"
                              disabled={isApproved || isVerifying}
                              onClick={() => { void handleVerifyEmailInModal(em); }}
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

                            <button
                              type="button"
                              disabled={isApproved || saving}
                              onClick={() => {
                                setEditingEmailKey(em);
                                setEditingEmailValue(em);
                              }}
                              title="Edit Email Address"
                              className="text-slate-400 hover:text-indigo-600 p-1 rounded hover:bg-indigo-50 transition-colors disabled:opacity-30"
                            >
                              <EditIcon width={13} height={13} />
                            </button>

                            <button
                              type="button"
                              disabled={isApproved || saving}
                              onClick={() => { void handleDeleteEmailInModal(em); }}
                              title="Remove email"
                              className="text-slate-400 hover:text-red-600 p-1 rounded hover:bg-red-50 transition-colors disabled:opacity-30"
                            >
                              <XIcon width={13} height={13} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-md p-2.5 text-xs text-amber-800 font-semibold italic flex items-center justify-between">
                <span>No contact emails added yet. Click "+ Add Email" above to add contact address.</span>
                <Badge tone="warning">⚠️ No Email Found</Badge>
              </div>
            )}

            {/* Collapsible Add Email Row matching Client Detail Page */}
            {isAddingEmail && (
              <div className="pt-2 border-t border-slate-200/80 space-y-1.5 bg-blue-50/40 border border-blue-100 rounded-md p-2.5">
                <label className="text-[10px] font-bold text-blue-900 uppercase tracking-wider block">
                  Add New Email & Verify SMTP
                </label>
                <div className="flex flex-col gap-1.5">
                  <div className="flex gap-2">
                    <input
                      type="email"
                      autoFocus
                      placeholder="Enter contact email (e.g. name@domain.com)..."
                      value={addingEmailValue}
                      onChange={(e) => setAddingEmailValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && isValidEmail(addingEmailValue)) {
                          void handleSaveAddEmail();
                        }
                      }}
                      disabled={isApproved || saving}
                      className={[
                        'flex-1 text-xs font-mono border rounded px-3 py-1.5 focus:ring-1 focus:outline-none bg-white disabled:opacity-50 transition-colors',
                        addingEmailValue.length > 0 && !isValidEmail(addingEmailValue)
                          ? 'border-red-400 focus:ring-red-500 bg-red-50/30 text-red-900 font-semibold'
                          : 'border-slate-300 focus:ring-indigo-500 text-slate-900',
                      ].join(' ')}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => { void handleSaveAddEmail(); }}
                      disabled={isApproved || saving || !isValidEmail(addingEmailValue)}
                      className="border-indigo-200 text-indigo-700 hover:bg-indigo-50 text-xs px-3 py-1.5 font-bold flex items-center gap-1 shrink-0 disabled:opacity-40 transition-all"
                    >
                      {saving ? <LoaderIcon width={11} height={11} className="animate-spin" /> : <PlusCircleIcon width={12} height={12} />}
                      + Add & Verify SMTP
                    </Button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsAddingEmail(false);
                        setAddingEmailValue('');
                      }}
                      className="text-[10px] font-semibold text-slate-400 hover:text-slate-600 px-1 shrink-0"
                    >
                      Cancel
                    </button>
                  </div>
                  {/* Zod-Style Error Helper for Add */}
                  {addingEmailValue.length > 0 && !isValidEmail(addingEmailValue) && (
                    <p className="text-[11px] font-medium text-red-600 flex items-center gap-1 animate-in fade-in">
                      <AlertTriangleIcon width={12} height={12} className="shrink-0 text-red-500" />
                      Invalid email address (e.g. name@domain.com)
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── 3. EMAIL HTML BODY & SUBJECT ───── */}
          <div className="space-y-3 border border-slate-200 rounded-lg p-3.5 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <label className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <SparklesIcon width={12} height={12} className="text-indigo-600" />
                Email Outreach Draft
              </label>
            </div>

            {/* Subject Line Input / Display */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Subject Line
              </label>
              {!isApproved ? (
                <input
                  type="text"
                  value={subjectInput}
                  onChange={(e) => setSubjectInput(e.target.value)}
                  disabled={saving}
                  placeholder="Enter email subject line..."
                  className="w-full text-xs font-bold text-slate-900 border border-slate-300 rounded px-3 py-2 focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white"
                />
              ) : (
                <div className="text-xs font-bold text-slate-900 bg-slate-50 border border-slate-200/80 rounded px-3 py-2">
                  {subjectInput || <span className="text-slate-400 italic">No subject line provided</span>}
                </div>
              )}
            </div>

            {/* Email HTML Body (WYSIWYG Editor when draft is editable) */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Email HTML Body (WYSIWYG Editor)
              </label>

              {!isApproved ? (
                <RichTextEditor initialValue={bodyHtmlInput} onChange={setBodyHtmlInput} readOnly={false} />
              ) : (
                <div className="bg-slate-50/70 border border-slate-200 rounded-md p-4 min-h-[160px] text-xs text-slate-800 leading-relaxed overflow-x-auto select-text">
                  {bodyHtmlInput ? (
                    <div dangerouslySetInnerHTML={{ __html: bodyHtmlInput }} />
                  ) : (
                    <span className="text-slate-400 italic font-medium">No email body generated yet. Crawl website above to generate email draft.</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* AI Refinement */}
          <div className="bg-indigo-50/50 border border-indigo-100 rounded-md p-3 space-y-2">
            <label className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider block">
              AI Refinement Instruction
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder={isApproved ? 'Unlock draft to refine with AI...' : 'e.g. Make email tone more casual'}
                value={refinePrompt}
                onChange={(e) => setRefinePrompt(e.target.value)}
                disabled={isApproved || refining}
                className="flex-1 text-xs border border-slate-200 rounded px-3 py-1.5 focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => { void handleImproveWithAi(); }}
                disabled={isApproved || refining || !refinePrompt.trim()}
                className="text-indigo-600 border-indigo-200 hover:bg-indigo-100 flex items-center gap-1 text-xs shrink-0 disabled:opacity-50"
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
              disabled={isInCampaign}
              onClick={handleToggleModalApprove}
              className={[
                'text-xs px-3 py-1.5 rounded-full font-bold border transition-all flex items-center gap-1',
                isInCampaign
                  ? 'bg-emerald-800 text-white border-emerald-900 cursor-not-allowed opacity-90'
                  : isApproved
                  ? 'bg-green-600 text-white border-green-600 hover:bg-green-700'
                  : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200',
              ].join(' ')}
              title={isInCampaign ? 'In active campaign sending flow — status cannot return to draft' : undefined}
            >
              {isInCampaign ? '🔒 In Campaign (Approved)' : isApproved ? '✓ Approved (Click to Draft)' : 'Mark as Approved'}
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

    const verifiedMap = new Map<string, VerifiedEmailItem['status']>();
    (leadDoc.verifiedEmails ?? []).forEach((v) => verifiedMap.set(v.email.toLowerCase(), v.status));

    const compObj = emailItem.companyIndex >= 0 ? leadDoc.currentCompanies?.[emailItem.companyIndex] : null;
    const availableEmails: string[] = Array.from(new Set(
      emailItem.companyIndex === -1
        ? (leadDoc.discoveredEmails ?? (leadDoc.email ? [leadDoc.email] : []))
        : (compObj?.companyEmails ?? [])
    ));

    const nextApproved = !emailItem.approved;

    if (nextApproved) {
      const eligibility = checkApprovalEligibility(availableEmails, verifiedMap);
      if (!eligibility.ok) {
        setCardError(eligibility.error!);
        setTimeout(() => setCardError(null), 5000);
        return;
      }
    }

    try {
      const companies = [...(leadDoc.currentCompanies ?? [])];
      if (emailItem.companyIndex !== -1 && companies[emailItem.companyIndex]) {
        companies[emailItem.companyIndex].approved = nextApproved;
      }

      const res = await updateLeadDetailsApi(emailItem.leadId, {
        ...(emailItem.companyIndex !== -1
          ? {
              currentCompanies: companies,
            }
          : {
              approved: nextApproved,
            }),
      });
      onLeadUpdated(res.result);
    } catch (err) {
      setCardError(err instanceof Error ? err.message : 'Failed to update approval status');
      setTimeout(() => setCardError(null), 4000);
    }
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

    // 1. Render Company-specific Drafts (Exclude those already in a campaign)
    companies.forEach((comp, idx) => {
      if (comp.emailSubject && comp.emailBody) {
        const isCompInCampaign = comp.inCampaign || (comp.campaignSendStatus && comp.campaignSendStatus !== 'pending');
        if (isCompInCampaign) return;

        const compEmails = comp.companyEmails ?? [];
        const targetEm = compEmails[0] ?? '';
        const status = targetEm ? (verifiedMap.get(targetEm) ?? 'pending') : 'pending';
        const computedSendStatus: GeneratedEmailItem['sendStatus'] = !targetEm.trim()
          ? 'no_contact_email'
          : (comp.campaignSendStatus as GeneratedEmailItem['sendStatus']) ?? (lead.emailStatus as GeneratedEmailItem['sendStatus']) ?? 'pending';

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

    // 2. Render Personal / Primary Draft (Exclude if already in a campaign)
    if (lead.emailSubject && lead.emailBody) {
      const isPersonalInCampaign = lead.inCampaign || (lead.campaignSendStatus && lead.campaignSendStatus !== 'pending') || lead.emailStatus === 'in_progress' || lead.emailStatus === 'delivered' || lead.emailStatus === 'opened';

      if (!isPersonalInCampaign) {
        const targetEm = lead.email ?? '';
        const status = targetEm ? (verifiedMap.get(targetEm) ?? lead.emailValidationStatus ?? 'pending') : 'pending';
        const computedSendStatus: GeneratedEmailItem['sendStatus'] = !targetEm.trim()
          ? 'no_contact_email'
          : (lead.campaignSendStatus as GeneratedEmailItem['sendStatus']) ?? (lead.emailStatus as GeneratedEmailItem['sendStatus']) ?? 'pending';

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
          title="Drafts"
          description="Review, edit and approve AI-written emails for each lead and company."
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
