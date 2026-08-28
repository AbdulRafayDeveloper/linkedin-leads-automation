'use client';

import { useEffect, useState } from 'react';
import { bulkDeleteLeadsApi, fetchLeads } from '@/lib/api/client';
import type { LeadRecord } from '@/lib/types/lead';
import FiltersPanel, { EMPTY_FILTERS, type FiltersState } from '@/components/leads/FiltersPanel';
import LeadsTable from '@/components/leads/LeadsTable';
import LeadDetailsModal from '@/components/leads/LeadDetailsModal';

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
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">My Leads</h1>
        {selectedIds.size > 0 && (
          <button
            type="button"
            onClick={handleBulkDelete}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
          >
            Delete {selectedIds.size} selected
          </button>
        )}
      </div>

      <div className="mb-4">
        <FiltersPanel filters={filters} onChange={handleFiltersChange} />
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <LeadsTable
        leads={leads}
        isLoading={isLoading}
        page={page}
        pages={pages}
        onPageChange={setPage}
        onRowClick={setSelectedLead}
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
            setSelectedLead(null);
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
