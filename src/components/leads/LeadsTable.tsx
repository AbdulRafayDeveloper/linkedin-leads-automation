'use client';

import { useMemo, useState } from 'react';
import type { LeadRecord } from '@/lib/types/lead';

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

const STATUS_BADGE: Record<string, string> = {
  PASS: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  APPROVED: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  FAIL: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  REJECTED: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  NEEDS_REVIEW: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  PENDING: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  NOT_FOUND: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
};

function Badge({ value }: { value: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[value] || 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800'}`}>
      {value.replace('_', ' ')}
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
    { key: 'fullName', label: 'Name' },
    { key: 'currentCompany', label: 'Company' },
    { key: 'validationStatus', label: 'Validation' },
    { key: 'approvalStatus', label: 'Approval' },
    { key: 'createdAt', label: 'Created' },
  ];

  if (isLoading) {
    return <div className="p-8 text-center text-sm text-neutral-500">Loading leads…</div>;
  }

  if (leads.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-neutral-500">
        No leads found. Process a new lead to get started.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
          <tr>
            <th className="px-3 py-2">
              <input
                type="checkbox"
                aria-label="Select all leads"
                checked={leads.length > 0 && leads.every((l) => selectedIds.has(l._id))}
                onChange={onToggleSelectAll}
              />
            </th>
            {columns.map((col) => (
              <th
                key={col.key}
                onClick={() => toggleSort(col.key)}
                className="cursor-pointer px-3 py-2 font-medium text-neutral-600 select-none dark:text-neutral-400"
              >
                {col.label}
                {sortKey === col.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
            <th className="px-3 py-2 font-medium text-neutral-600 dark:text-neutral-400">Title</th>
            <th className="px-3 py-2 font-medium text-neutral-600 dark:text-neutral-400">Email</th>
          </tr>
        </thead>
        <tbody>
          {sortedLeads.map((lead) => (
            <tr
              key={lead._id}
              onClick={() => onRowClick(lead)}
              className="cursor-pointer border-b border-neutral-100 hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900"
            >
              <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  aria-label={`Select ${lead.fullName}`}
                  checked={selectedIds.has(lead._id)}
                  onChange={() => onToggleSelect(lead._id)}
                />
              </td>
              <td className="px-3 py-2 font-medium">{lead.fullName}</td>
              <td className="px-3 py-2">{lead.currentCompany}</td>
              <td className="px-3 py-2">
                <Badge value={lead.validationStatus} />
              </td>
              <td className="px-3 py-2">
                <Badge value={lead.approvalStatus} />
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-neutral-500">
                {new Date(lead.createdAt).toLocaleDateString()}
              </td>
              <td className="px-3 py-2 text-neutral-500">{lead.currentTitle || '—'}</td>
              <td className="px-3 py-2 text-neutral-500">{lead.email || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex items-center justify-between border-t border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800">
        <span className="text-neutral-500">
          Page {page} of {pages}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="rounded-md border border-neutral-300 px-3 py-1 disabled:opacity-40 dark:border-neutral-700"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={page >= pages}
            onClick={() => onPageChange(page + 1)}
            className="rounded-md border border-neutral-300 px-3 py-1 disabled:opacity-40 dark:border-neutral-700"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
