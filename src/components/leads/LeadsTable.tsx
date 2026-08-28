'use client';

import { useMemo, useState } from 'react';
import type { LeadRecord } from '@/lib/types/lead';
import { StatusBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import Button from '@/components/ui/Button';
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, InboxIcon, LoaderIcon } from '@/components/ui/Icons';
import { cn } from '@/lib/utils/cn';

type SortKey = 'fullName' | 'currentCompany' | 'validationStatus' | 'approvalStatus' | 'createdAt';

interface LeadsTableProps {
  leads: LeadRecord[];
  isLoading: boolean;
  page: number;
  pages: number;
  onPageChange: (page: number) => void;
  onRowClick: (lead: LeadRecord) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-600">
      {initials(name)}
    </span>
  );
}

export default function LeadsTable({
  leads,
  isLoading,
  page,
  pages,
  onPageChange,
  onRowClick,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
}: LeadsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sortedLeads = useMemo(() => {
    const copy = [...leads];
    copy.sort((a, b) => {
      const aVal = a[sortKey] ?? '';
      const bVal = b[sortKey] ?? '';
      const comparison = String(aVal).localeCompare(String(bVal));
      return sortDir === 'asc' ? comparison : -comparison;
    });
    return copy;
  }, [leads, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const columns: { key: SortKey; label: string }[] = [
    { key: 'fullName', label: 'Lead' },
    { key: 'currentCompany', label: 'Company' },
    { key: 'validationStatus', label: 'Validation' },
    { key: 'approvalStatus', label: 'Approval' },
    { key: 'createdAt', label: 'Created' },
  ];

  if (isLoading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500">
          <LoaderIcon width={16} height={16} />
          Loading leads…
        </div>
      </div>
    );
  }

  if (leads.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <EmptyState
          icon={<InboxIcon width={20} height={20} />}
          title="No leads found."
          description="Process a new lead to get started."
        />
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="w-10 px-4 py-2.5">
                <input
                  type="checkbox"
                  aria-label="Select all leads"
                  checked={leads.length > 0 && leads.every((l) => selectedIds.has(l._id))}
                  onChange={onToggleSelectAll}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
              </th>
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  className="cursor-pointer px-4 py-2.5 text-xs font-semibold tracking-wide text-slate-500 uppercase select-none hover:text-slate-700"
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    <ChevronDownIcon
                      width={12}
                      height={12}
                      className={cn(
                        'transition-transform',
                        sortKey === col.key ? 'text-slate-500' : 'text-transparent',
                        sortKey === col.key && sortDir === 'asc' ? 'rotate-180' : ''
                      )}
                    />
                  </span>
                </th>
              ))}
              <th className="px-4 py-2.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Title
              </th>
              <th className="px-4 py-2.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Email
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sortedLeads.map((lead) => {
              const extraEmails = Math.max((lead.emails?.length ?? 0) - 1, 0);
              return (
                <tr
                  key={lead._id}
                  onClick={() => onRowClick(lead)}
                  className="cursor-pointer transition-colors hover:bg-slate-50"
                >
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${lead.fullName}`}
                      checked={selectedIds.has(lead._id)}
                      onChange={() => onToggleSelect(lead._id)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={lead.fullName} />
                      <span className="font-medium text-slate-900">{lead.fullName}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{lead.currentCompany || '—'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge value={lead.validationStatus} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge value={lead.approvalStatus} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-500">
                    {new Date(lead.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{lead.currentTitle || '—'}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {lead.email ? (
                      <span className="inline-flex items-center gap-1.5">
                        {lead.email}
                        {extraEmails > 0 && (
                          <span
                            title={`${extraEmails} more email${extraEmails > 1 ? 's' : ''} on file`}
                            className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500"
                          >
                            +{extraEmails}
                          </span>
                        )}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm">
        <span className="text-slate-500">
          Page {page} of {pages}
        </span>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeftIcon width={14} height={14} />
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= pages}
            onClick={() => onPageChange(page + 1)}
          >
            Next
            <ChevronRightIcon width={14} height={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}
