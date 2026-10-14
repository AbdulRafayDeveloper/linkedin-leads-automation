import { Badge } from '@/components/ui/Badge';
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  LoaderIcon,
  MailIcon,
  XCircleIcon,
} from '@/components/ui/Icons';
import type { DraftItem } from '@/services/lead-ingestion/draftItems';

/**
 * Status labels for a draft. Text plus an icon from the shared set, so the
 * meaning doesn't depend on colour or on an emoji a screen reader spells out.
 */

export function SmtpBadge({ status }: { status: DraftItem['smtpStatus'] }) {
  if (status === null) {
    return (
      <Badge tone="warning" icon={<AlertTriangleIcon width={11} height={11} />}>
        No contact email
      </Badge>
    );
  }
  if (status === 'valid') {
    return (
      <Badge tone="success" icon={<CheckCircleIcon width={11} height={11} />}>
        Verified
      </Badge>
    );
  }
  if (status === 'risky') {
    return (
      <Badge tone="success" icon={<CheckCircleIcon width={11} height={11} />}>
        Verified (risky)
      </Badge>
    );
  }
  if (status === 'invalid') {
    return (
      <Badge tone="danger" icon={<XCircleIcon width={11} height={11} />}>
        Invalid address
      </Badge>
    );
  }
  return (
    <Badge tone="warning" icon={<AlertTriangleIcon width={11} height={11} />}>
      Not verified
    </Badge>
  );
}

export function SendStatusBadge({ status }: { status: DraftItem['sendStatus'] }) {
  if (status === 'no_contact_email') {
    return (
      <Badge tone="warning" icon={<AlertTriangleIcon width={11} height={11} />}>
        No contact email
      </Badge>
    );
  }
  if (status === 'opened') {
    return (
      <Badge tone="info" icon={<MailIcon width={11} height={11} />}>
        Opened
      </Badge>
    );
  }
  if (status === 'delivered') {
    return (
      <Badge tone="success" icon={<CheckCircleIcon width={11} height={11} />}>
        Delivered
      </Badge>
    );
  }
  if (status === 'failed') {
    return (
      <Badge tone="danger" icon={<XCircleIcon width={11} height={11} />}>
        Send failed
      </Badge>
    );
  }
  if (status === 'in_progress') {
    return (
      <Badge tone="info" icon={<LoaderIcon width={11} height={11} className="animate-spin" />}>
        Sending
      </Badge>
    );
  }
  return (
    <Badge tone="neutral" icon={<ClockIcon width={11} height={11} />}>
      Not sent
    </Badge>
  );
}
