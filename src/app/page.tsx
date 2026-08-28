'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchLeads } from '@/lib/api/client';
import { buttonClasses } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  ClockIcon,
  InboxIcon,
  MailIcon,
  PlusCircleIcon,
  UsersIcon,
} from '@/components/ui/Icons';

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

  const statCards = [
    { label: 'Total Leads', value: stats?.total, icon: InboxIcon, tone: 'text-slate-500 bg-slate-100' },
    { label: 'Pending Review', value: stats?.pending, icon: ClockIcon, tone: 'text-amber-600 bg-amber-50' },
    { label: 'Approved', value: stats?.approved, icon: CheckCircleIcon, tone: 'text-emerald-600 bg-emerald-50' },
    { label: 'Email Validated', value: stats?.validated, icon: MailIcon, tone: 'text-indigo-600 bg-indigo-50' },
  ];

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          LinkedIn Lead Intelligence Engine
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-500">
          Research Sales Navigator leads, discover and validate emails, and generate personalized
          outreach, all stored in MongoDB.
        </p>
      </div>

      {error && (
        <div className="mb-6 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangleIcon width={16} height={16} />
          {error}
        </div>
      )}

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label} className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">{stat.label}</span>
                <span className={`flex h-7 w-7 items-center justify-center rounded-md ${stat.tone}`}>
                  <Icon width={14} height={14} />
                </span>
              </div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">
                {stat.value === undefined ? (
                  <span className="inline-block h-7 w-12 animate-pulse rounded bg-slate-100 align-middle" />
                ) : (
                  stat.value
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="flex flex-col gap-3 p-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-indigo-50 text-indigo-600">
            <PlusCircleIcon width={18} height={18} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Process a new lead</h2>
            <p className="mt-1 text-sm text-slate-500">
              Paste a Sales Navigator profile and let the pipeline research, validate, and draft
              outreach automatically.
            </p>
          </div>
          <Link href="/process" className={buttonClasses('primary', 'sm', 'mt-1 self-start')}>
            Process New Lead
            <ArrowRightIcon width={14} height={14} />
          </Link>
        </Card>

        <Card className="flex flex-col gap-3 p-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-100 text-slate-600">
            <UsersIcon width={18} height={18} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Review your pipeline</h2>
            <p className="mt-1 text-sm text-slate-500">
              Browse, filter, and approve leads, review validation status, and manage generated
              emails.
            </p>
          </div>
          <Link href="/dashboard" className={buttonClasses('outline', 'sm', 'mt-1 self-start')}>
            View My Leads
            <ArrowRightIcon width={14} height={14} />
          </Link>
        </Card>
      </div>
    </div>
  );
}
