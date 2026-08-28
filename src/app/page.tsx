'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchLeads } from '@/lib/api/client';

interface Stats {
  total: number;
  pending: number;
  approved: number;
  validated: number;
}

export default function Home() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadStats() {
      try {
        const [all, pending, approved, validated] = await Promise.all([
          fetchLeads({ limit: 1 }),
          fetchLeads({ limit: 1, approvalStatus: 'PENDING' }),
          fetchLeads({ limit: 1, approvalStatus: 'APPROVED' }),
          fetchLeads({ limit: 1, validationStatus: 'PASS' }),
        ]);
        setStats({
          total: all.total,
          pending: pending.total,
          approved: approved.total,
          validated: validated.total,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load stats');
      }
    }
    loadStats();
  }, []);

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-2 text-3xl font-bold">LinkedIn Lead Intelligence Engine</h1>
      <p className="mb-8 text-neutral-500">
        Research Sales Navigator leads, discover and validate emails, and generate personalized
        outreach, all stored in MongoDB.
      </p>

      {error && <p className="mb-6 text-sm text-red-600">{error}</p>}

      {stats && (
        <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: 'Total Leads', value: stats.total },
            { label: 'Pending Review', value: stats.pending },
            { label: 'Approved', value: stats.approved },
            { label: 'Email Validated', value: stats.validated },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
            >
              <div className="text-2xl font-semibold">{stat.value}</div>
              <div className="text-sm text-neutral-500">{stat.label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-3">
        <Link
          href="/process"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900"
        >
          Process New Lead
        </Link>
        <Link
          href="/dashboard"
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          View My Leads
        </Link>
      </div>
    </div>
  );
}
