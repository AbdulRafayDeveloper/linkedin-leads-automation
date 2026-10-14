'use client';

import { useId } from 'react';
import Button from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { AlertTriangleIcon, RefreshIcon, SearchIcon, XIcon } from '@/components/ui/Icons';
import {
  RANGE_OPTIONS,
  STATUS_OPTIONS,
  hasActiveFilters,
  todayAsInputValue,
  type LeadFilters as Filters,
  type RangeKey,
  type StatusKey,
} from '@/lib/leads/listFilters';

/** Caption above a Select, which carries its own (screen-reader) label. */
function SelectField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span aria-hidden="true" className="text-xs font-medium text-slate-600">
        {label}
      </span>
      {children}
    </div>
  );
}

export default function LeadFilters({
  filters,
  clients,
  busy,
  dateError,
  onChange,
  onReset,
  onRefresh,
}: {
  filters: Filters;
  clients: { id: string; name: string }[];
  busy: boolean;
  dateError?: string;
  onChange: (patch: Partial<Filters>) => void;
  onReset: () => void;
  onRefresh: () => void;
}) {
  const id = useId();
  const today = todayAsInputValue();
  const active = hasActiveFilters(filters);

  const clientOptions = [
    { value: 'all', label: 'All clients' },
    ...clients.map((client) => ({ value: client.id, label: client.name })),
  ];

  return (
    <Card>
      <CardContent className="space-y-3 px-4 py-3.5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Search" htmlFor={`${id}-search`} className="sm:col-span-2">
            <div className="relative">
              <SearchIcon
                width={15}
                height={15}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
              />
              <Input
                id={`${id}-search`}
                type="search"
                value={filters.search}
                onChange={(event) => onChange({ search: event.target.value })}
                placeholder="Name, company, email or LinkedIn URL"
                className="pl-9"
              />
            </div>
          </Field>

          <SelectField label="Date added">
            <Select<RangeKey>
              label="Date added"
              value={filters.range}
              options={[...RANGE_OPTIONS]}
              onChange={(range) => onChange({ range })}
              widthClass="w-full"
            />
          </SelectField>

          <SelectField label="Status">
            <Select<StatusKey>
              label="Status"
              value={filters.status}
              options={[...STATUS_OPTIONS]}
              onChange={(status) => onChange({ status })}
              widthClass="w-full"
            />
          </SelectField>

          {clients.length > 0 && (
            <SelectField label="Client">
              <Select
                label="Client"
                value={filters.clientId}
                options={clientOptions}
                onChange={(clientId) => onChange({ clientId })}
                widthClass="w-full"
                searchable
              />
            </SelectField>
          )}
        </div>

        {filters.range === 'custom' && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Field label="From" htmlFor={`${id}-from`}>
              <Input
                id={`${id}-from`}
                type="date"
                max={filters.to || today}
                value={filters.from}
                onChange={(event) => onChange({ from: event.target.value })}
                aria-invalid={Boolean(dateError)}
              />
            </Field>
            <Field label="To" htmlFor={`${id}-to`}>
              <Input
                id={`${id}-to`}
                type="date"
                min={filters.from || undefined}
                max={today}
                value={filters.to}
                onChange={(event) => onChange({ to: event.target.value })}
                aria-invalid={Boolean(dateError)}
              />
            </Field>
            {dateError && (
              <p
                role="alert"
                className="flex items-center gap-1.5 self-end pb-2 text-xs font-medium text-red-600 sm:col-span-2"
              >
                <AlertTriangleIcon width={14} height={14} className="shrink-0" />
                {dateError}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {active && (
            <Button variant="ghost" size="sm" onClick={onReset}>
              <XIcon width={14} height={14} />
              Clear filters
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={busy}>
            <RefreshIcon width={14} height={14} className={busy ? 'animate-spin' : undefined} />
            Refresh
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
