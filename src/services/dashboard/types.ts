/** Shared between the dashboard API (server) and the dashboard page (client). */

export type Granularity = 'hour' | 'day' | 'month';

export interface MetricWithDelta {
  value: number;
  /** Same metric over the previous period of equal length; null for all-time. */
  previous: number | null;
}

export type LeadStage = 'processing' | 'imported' | 'email_found' | 'verified' | 'drafted' | 'approved' | 'contacted';

export interface FunnelStep {
  key: Exclude<LeadStage, 'processing'>;
  label: string;
  value: number;
}

export interface SeriesPoint {
  key: string;
  /** Short axis label, e.g. "Sep 14" or "2 PM". */
  label: string;
  /** Tooltip / table label, e.g. "Mon, Sep 14". */
  fullLabel: string;
  leads: number;
  sent: number;
  opened: number;
}

export interface RecentLead {
  id: string;
  fullName: string;
  companyName: string | null;
  createdAt: string;
  emailCount: number;
  stage: LeadStage;
}

export interface RecentCampaign {
  id: string;
  name: string;
  status: 'draft' | 'running' | 'completed' | 'paused';
  total: number;
  processed: number;
  delivered: number;
  opened: number;
  failed: number;
  updatedAt: string;
}

export interface DashboardStats {
  range: {
    from: string;
    to: string;
    granularity: Granularity;
    isAllTime: boolean;
  };
  trackingEnabled: boolean;
  kpis: {
    leads: MetricWithDelta;
    emailsFound: MetricWithDelta;
    verified: MetricWithDelta;
    sent: MetricWithDelta;
    opened: MetricWithDelta;
  };
  funnel: FunnelStep[];
  verification: { valid: number; risky: number; invalid: number; unknown: number; pending: number };
  drafts: { written: number; awaitingReview: number; approved: number; inCampaign: number };
  /** `leadsWithPhone` counts leads, not numbers: crawled pages can yield hundreds of false "phones". */
  research: { companies: number; withWebsite: number; leadsWithPhone: number; crawlsFailed: number };
  delivery: {
    delivered: number;
    opened: number;
    failed: number;
    /** Current queue across all campaigns, not limited to the period. */
    queued: number;
    /** delivered / (delivered + failed) for the period, null when nothing was sent. */
    deliveryRate: number | null;
    /** Share of emails delivered in the period that were opened. */
    openRate: number | null;
  };
  campaigns: {
    running: number;
    paused: number;
    completed: number;
    draft: number;
    recent: RecentCampaign[];
  };
  recentLeads: RecentLead[];
  series: SeriesPoint[];
}
