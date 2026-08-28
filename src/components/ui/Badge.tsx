import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';
import {
  CheckCircleIcon,
  ClockIcon,
  LoaderIcon,
  XCircleIcon,
  AlertTriangleIcon,
  type IconProps,
} from './Icons';

export type BadgeTone = 'neutral' | 'success' | 'danger' | 'warning' | 'info';

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200',
  success: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
  danger: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200',
  warning: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
  info: 'bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200',
};

interface BadgeProps {
  tone?: BadgeTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Badge({ tone = 'neutral', icon, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONE_CLASSES[tone],
        className
      )}
    >
      {icon}
      {children}
    </span>
  );
}

interface StatusMeta {
  tone: BadgeTone;
  label: string;
  Icon?: (props: IconProps) => ReactNode;
}

const STATUS_MAP: Record<string, StatusMeta> = {
  PASS: { tone: 'success', label: 'Valid', Icon: CheckCircleIcon },
  APPROVED: { tone: 'success', label: 'Approved', Icon: CheckCircleIcon },
  COMPLETE: { tone: 'success', label: 'Complete', Icon: CheckCircleIcon },
  COMPLETED: { tone: 'success', label: 'Completed', Icon: CheckCircleIcon },
  valid: { tone: 'success', label: 'Valid', Icon: CheckCircleIcon },
  SENT: { tone: 'success', label: 'Sent', Icon: CheckCircleIcon },

  FAIL: { tone: 'danger', label: 'Invalid', Icon: XCircleIcon },
  REJECTED: { tone: 'danger', label: 'Rejected', Icon: XCircleIcon },
  FAILED: { tone: 'danger', label: 'Failed', Icon: XCircleIcon },
  ERROR: { tone: 'danger', label: 'Error', Icon: XCircleIcon },
  invalid: { tone: 'danger', label: 'Invalid', Icon: XCircleIcon },
  BOUNCED: { tone: 'danger', label: 'Bounced', Icon: XCircleIcon },

  NEEDS_REVIEW: { tone: 'warning', label: 'Needs Review', Icon: AlertTriangleIcon },
  PENDING: { tone: 'warning', label: 'Pending', Icon: ClockIcon },
  pending: { tone: 'warning', label: 'Pending', Icon: ClockIcon },
  risky: { tone: 'warning', label: 'Risky', Icon: AlertTriangleIcon },
  DRAFT_CREATED: { tone: 'info', label: 'Draft Created', Icon: ClockIcon },

  QUEUED: { tone: 'neutral', label: 'Queued', Icon: ClockIcon },
  IDENTIFYING_COMPANY: { tone: 'info', label: 'Identifying Company', Icon: LoaderIcon },
  FINDING_WEBSITE: { tone: 'info', label: 'Finding Website', Icon: LoaderIcon },
  CRAWLING: { tone: 'info', label: 'Crawling', Icon: LoaderIcon },
  EXTRACTING: { tone: 'info', label: 'Extracting', Icon: LoaderIcon },
  VALIDATING: { tone: 'info', label: 'Validating', Icon: LoaderIcon },
  in_progress: { tone: 'info', label: 'In Progress', Icon: LoaderIcon },

  NOT_FOUND: { tone: 'neutral', label: 'Not Found' },
  NOT_SENT: { tone: 'neutral', label: 'Not Sent' },
  not_started: { tone: 'neutral', label: 'Not Started' },
  unknown: { tone: 'neutral', label: 'Unknown' },
  skipped: { tone: 'neutral', label: 'Skipped' },
};

export function StatusBadge({ value, className }: { value: string; className?: string }) {
  const meta = STATUS_MAP[value] ?? { tone: 'neutral' as BadgeTone, label: value.replace(/_/g, ' ') };
  const Icon = meta.Icon;
  return (
    <Badge tone={meta.tone} className={className} icon={Icon ? <Icon width={12} height={12} /> : undefined}>
      {meta.label}
    </Badge>
  );
}
