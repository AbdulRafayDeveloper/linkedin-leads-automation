/** Shared between the dashboard API (server) and the dashboard page (client). */

export type Granularity = 'hour' | 'day' | 'week' | 'month';

export interface MetricWithDelta {
  value: number;
  /** Same metric over the comparison window; null for all-time. */
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
  /** Null when the extraction produced no real name. */
  fullName: string | null;
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
    /** The zone every bucket and day boundary was computed in. */
    timeZone: string;
    /** The window the deltas compare against; null for all-time. */
    comparison: { from: string; to: string } | null;
  };
  /** When these numbers were computed, so the page can show their age. */
  generatedAt: string;
  trackingEnabled: boolean;
  /** False when the workspace holds no leads and no campaigns at all. */
  hasAnyData: boolean;
  kpis: {
    /** Leads imported in the range. */
    leads: MetricWithDelta;
    /** Distinct email addresses found on those leads. */
    emailsFound: MetricWithDelta;
    /** Distinct addresses SMTP accepted (valid or risky). */
    verified: MetricWithDelta;
    /** Emails sent in the range. */
    sent: MetricWithDelta;
    /** Opens recorded in the range. */
    opened: MetricWithDelta;
  };
  /** Leads from the range that ever reached each step; steps are independent. */
  funnel: FunnelStep[];
  /** One entry per distinct address found on the range's leads. */
  verification: { valid: number; risky: number; invalid: number; unknown: number; pending: number };
  /** Counted per draft box (personal draft + one per company). */
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
    /** Share of the emails sent in this period that have been opened. */
    openRate: number | null;
  };
  campaigns: {
    running: number;
    paused: number;
    completed: number;
    draft: number;
    /** Latest campaigns by update time, never filtered by the range. */
    recent: RecentCampaign[];
  };
  recentLeads: RecentLead[];
  series: SeriesPoint[];
}
