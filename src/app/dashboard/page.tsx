'use client';

import { useEffect, useState } from 'react';
import { bulkDeleteLeadsApi, fetchLeads } from '@/lib/api/client';
import type { LeadRecord } from '@/lib/types/lead';
import FiltersPanel, { EMPTY_FILTERS, type FiltersState } from '@/components/leads/FiltersPanel';
import LeadsCards from '@/components/leads/LeadsCards';
import LeadDetailsModal from '@/components/leads/LeadDetailsModal';
import { PageHeader } from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import { AlertTriangleIcon, TrashIcon } from '@/components/ui/Icons';

export default function DashboardPage() {
  const [leads, setLeads] = useState<LeadRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [filters, setFilters] = useState<FiltersState>(EMPTY_FILTERS);
  const [selectedLead, setSelectedLead] = useState<LeadRecord | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadLeads() {
      setIsLoading(true);
      setError(null);
      try {
        const result = await fetchLeads({
          page,
          approvalStatus: filters.approvalStatus || undefined,
          validationStatus: filters.validationStatus || undefined,
          sentStatus: filters.sentStatus || undefined,
          search: filters.search || undefined,
          startDate: filters.startDate || undefined,
          endDate: filters.endDate || undefined,
        });
        if (cancelled) return;
        setLeads(result.leads);
        setPages(result.pages);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load leads');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadLeads();
    return () => {
      cancelled = true;
    };
  }, [page, filters, reloadToken]);

  const handleFiltersChange = (next: FiltersState) => {
    setFilters(next);
    setPage(1);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const allSelected = leads.length > 0 && leads.every((l) => prev.has(l._id));
      return allSelected ? new Set() : new Set(leads.map((l) => l._id));
    });
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} selected lead(s)? This cannot be undone.`)) return;
    await bulkDeleteLeadsApi(Array.from(selectedIds));
    setSelectedIds(new Set());
    setReloadToken((token) => token + 1);
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <PageHeader
        title="My Leads"
        description="Browse, filter, and manage leads discovered through the research pipeline."
        actions={
          selectedIds.size > 0 && (
            <Button type="button" variant="destructive" size="sm" onClick={handleBulkDelete}>
              <TrashIcon width={14} height={14} />
              Delete {selectedIds.size} selected
            </Button>
          )
        }
      />

      <div className="mb-4">
        <FiltersPanel filters={filters} onChange={handleFiltersChange} />
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangleIcon width={16} height={16} />
          {error}
        </div>
      )}

      <LeadsCards
        leads={leads}
        isLoading={isLoading}
        page={page}
        pages={pages}
        onPageChange={setPage}
        onOpenDetails={setSelectedLead}
        onUpdated={(updated) => {
          setLeads((prev) => prev.map((l) => (l._id === updated._id ? updated : l)));
        }}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        onToggleSelectAll={toggleSelectAll}
      />

      {selectedLead && (
        <LeadDetailsModal
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onUpdated={(updated) => {
            setLeads((prev) => prev.map((l) => (l._id === updated._id ? updated : l)));
            setSelectedLead(updated);
          }}
          onDeleted={(id) => {
            setLeads((prev) => prev.filter((l) => l._id !== id));
            setSelectedLead(null);
          }}
        />
      )}
    </div>
  );
}
