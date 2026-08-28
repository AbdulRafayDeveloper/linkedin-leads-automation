'use client';

import LeadCard from '@/components/leads/LeadCard';
import Button from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { InboxIcon, LoaderIcon } from '@/components/ui/Icons';
import type { LeadRecord } from '@/lib/types/lead';

interface LeadsCardsProps {
  leads: LeadRecord[];
  isLoading: boolean;
  page: number;
  pages: number;
  onPageChange: (page: number) => void;
  onOpenDetails: (lead: LeadRecord) => void;
  onUpdated: (lead: LeadRecord) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
}

export default function LeadsCards({
  leads,
  isLoading,
  page,
  pages,
  onPageChange,
  onOpenDetails,
  onUpdated,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
}: LeadsCardsProps) {
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

  const allSelected = leads.every((lead) => selectedIds.has(lead._id));

  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={onToggleSelectAll}
          aria-label="Select all leads"
          className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
        />
        Select all on this page
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {leads.map((lead) => (
          <LeadCard
            key={lead._id}
            lead={lead}
            selected={selectedIds.has(lead._id)}
            onToggleSelect={onToggleSelect}
            onOpenDetails={onOpenDetails}
            onUpdated={onUpdated}
          />
        ))}
      </div>

      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">
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
          </Button>
        </div>
      </div>
    </div>
  );
}
