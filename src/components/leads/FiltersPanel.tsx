'use client';

import type { ApprovalStatus, SentStatus, ValidationStatus } from '@/lib/types/lead';
import { Field } from '@/components/ui/Field';
import { Input, Select } from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import { SearchIcon } from '@/components/ui/Icons';

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
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Search" htmlFor="search" className="min-w-[200px] flex-1">
          <div className="relative">
            <SearchIcon
              width={14}
              height={14}
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400"
            />
            <Input
              id="search"
              type="text"
              placeholder="Name or email"
              value={filters.search}
              onChange={(e) => update('search', e.target.value)}
              className="pl-8"
            />
          </div>
        </Field>

        <Field label="Approval Status" htmlFor="approvalStatus" className="w-44">
          <Select
            id="approvalStatus"
            value={filters.approvalStatus}
            onChange={(e) => update('approvalStatus', e.target.value as FiltersState['approvalStatus'])}
          >
            <option value="">All</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </Select>
        </Field>

        <Field label="Validation Status" htmlFor="validationStatus" className="w-44">
          <Select
            id="validationStatus"
            value={filters.validationStatus}
            onChange={(e) => update('validationStatus', e.target.value as FiltersState['validationStatus'])}
          >
            <option value="">All</option>
            <option value="PASS">Pass</option>
            <option value="FAIL">Fail</option>
            <option value="NEEDS_REVIEW">Needs Review</option>
            <option value="NOT_FOUND">Not Found</option>
          </Select>
        </Field>

        <Field label="Sent Status" htmlFor="sentStatus" className="w-44">
          <Select
            id="sentStatus"
            value={filters.sentStatus}
            onChange={(e) => update('sentStatus', e.target.value as FiltersState['sentStatus'])}
          >
            <option value="">All</option>
            <option value="NOT_SENT">Not Sent</option>
            <option value="DRAFT_CREATED">Draft Created</option>
            <option value="SENT">Sent</option>
            <option value="BOUNCED">Bounced</option>
          </Select>
        </Field>

        <Field label="From" htmlFor="startDate" className="w-36">
          <Input
            id="startDate"
            type="date"
            value={filters.startDate}
            onChange={(e) => update('startDate', e.target.value)}
          />
        </Field>

        <Field label="To" htmlFor="endDate" className="w-36">
          <Input
            id="endDate"
            type="date"
            value={filters.endDate}
            onChange={(e) => update('endDate', e.target.value)}
          />
        </Field>

        <Button type="button" variant="outline" size="md" onClick={() => onChange(EMPTY_FILTERS)}>
          Reset filters
        </Button>
      </div>
    </div>
  );
}
