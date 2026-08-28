'use client';

import type { ApprovalStatus, SentStatus, ValidationStatus } from '@/lib/types/lead';

export interface FiltersState {
  search: string;
  approvalStatus: ApprovalStatus | '';
  validationStatus: ValidationStatus | '';
  sentStatus: SentStatus | '';
  startDate: string;
  endDate: string;
}

export const EMPTY_FILTERS: FiltersState = {
  search: '',
  approvalStatus: '',
  validationStatus: '',
  sentStatus: '',
  startDate: '',
  endDate: '',
};

interface FiltersPanelProps {
  filters: FiltersState;
  onChange: (filters: FiltersState) => void;
}

export default function FiltersPanel({ filters, onChange }: FiltersPanelProps) {
  const update = <K extends keyof FiltersState>(key: K, value: FiltersState[K]) => {
    onChange({ ...filters, [key]: value });
  };

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex flex-col gap-1">
        <label htmlFor="search" className="text-xs font-medium text-neutral-500">
          Search
        </label>
        <input
          id="search"
          type="text"
          placeholder="Name or email"
          value={filters.search}
          onChange={(e) => update('search', e.target.value)}
          className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="approvalStatus" className="text-xs font-medium text-neutral-500">
          Approval Status
        </label>
        <select
          id="approvalStatus"
          value={filters.approvalStatus}
          onChange={(e) => update('approvalStatus', e.target.value as FiltersState['approvalStatus'])}
          className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        >
          <option value="">All</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="validationStatus" className="text-xs font-medium text-neutral-500">
          Validation Status
        </label>
        <select
          id="validationStatus"
          value={filters.validationStatus}
          onChange={(e) => update('validationStatus', e.target.value as FiltersState['validationStatus'])}
          className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        >
          <option value="">All</option>
          <option value="PASS">Pass</option>
          <option value="FAIL">Fail</option>
          <option value="NEEDS_REVIEW">Needs Review</option>
          <option value="NOT_FOUND">Not Found</option>
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="sentStatus" className="text-xs font-medium text-neutral-500">
          Sent Status
        </label>
        <select
          id="sentStatus"
          value={filters.sentStatus}
          onChange={(e) => update('sentStatus', e.target.value as FiltersState['sentStatus'])}
          className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        >
          <option value="">All</option>
          <option value="NOT_SENT">Not Sent</option>
          <option value="DRAFT_CREATED">Draft Created</option>
          <option value="SENT">Sent</option>
          <option value="BOUNCED">Bounced</option>
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="startDate" className="text-xs font-medium text-neutral-500">
          From
        </label>
        <input
          id="startDate"
          type="date"
          value={filters.startDate}
          onChange={(e) => update('startDate', e.target.value)}
          className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="endDate" className="text-xs font-medium text-neutral-500">
          To
        </label>
        <input
          id="endDate"
          type="date"
          value={filters.endDate}
          onChange={(e) => update('endDate', e.target.value)}
          className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
      </div>

      <button
        type="button"
        onClick={() => onChange(EMPTY_FILTERS)}
        className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
      >
        Reset filters
      </button>
    </div>
  );
}
