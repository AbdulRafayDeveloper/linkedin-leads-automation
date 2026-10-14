import { Badge } from '@/components/ui/Badge';
import {
  CheckCircleIcon,
  ClockIcon,
  LoaderIcon,
  PauseIcon,
  SendIcon,
  XCircleIcon,
  EyeIcon,
  AlertTriangleIcon,
} from '@/components/ui/Icons';
import type { CampaignItemStatus, CampaignStatus } from '@/services/lead-ingestion/apiClient';

/**
 * Status of a whole campaign. `running` only spins while a tab is actively
 * driving it; a campaign whose runner went away is shown as paused by the API.
 */
export function CampaignStatusBadge({
  status,
  isRunnerActive = false,
}: {
  status: CampaignStatus;
  isRunnerActive?: boolean;
}) {
  if (status === 'completed') {
    return (
      <Badge tone="success" icon={<CheckCircleIcon width={12} height={12} />}>
        Completed
      </Badge>
    );
  }
  if (status === 'running') {
    return isRunnerActive ? (
      <Badge tone="info" icon={<LoaderIcon width={12} height={12} className="animate-spin" />}>
        Sending
      </Badge>
    ) : (
      <Badge tone="info" icon={<SendIcon width={12} height={12} />}>
        Running
      </Badge>
    );
  }
  if (status === 'paused') {
    return (
      <Badge tone="warning" icon={<PauseIcon width={12} height={12} />}>
        Paused
      </Badge>
    );
  }
  return (
    <Badge tone="neutral" icon={<ClockIcon width={12} height={12} />}>
      Draft
    </Badge>
  );
}

/** Status of one recipient in a campaign. */
export function CampaignItemStatusBadge({
  status,
  isNext = false,
}: {
  status: CampaignItemStatus;
  /** The pending item that will be sent next while the runner waits. */
  isNext?: boolean;
}) {
  if (status === 'opened') {
    return (
      <Badge tone="info" icon={<EyeIcon width={12} height={12} />}>
        Opened
      </Badge>
    );
  }
  if (status === 'delivered') {
    return (
      <Badge tone="success" icon={<CheckCircleIcon width={12} height={12} />}>
        Delivered
      </Badge>
    );
  }
  if (status === 'failed') {
    return (
      <Badge tone="danger" icon={<XCircleIcon width={12} height={12} />}>
        Failed
      </Badge>
    );
  }
  if (status === 'sending') {
    return (
      <Badge tone="info" icon={<LoaderIcon width={12} height={12} className="animate-spin" />}>
        Sending
      </Badge>
    );
  }
  if (isNext) {
    return (
      <Badge tone="warning" icon={<AlertTriangleIcon width={12} height={12} />}>
        Next up
      </Badge>
    );
  }
  return (
    <Badge tone="neutral" icon={<ClockIcon width={12} height={12} />}>
      Pending
    </Badge>
  );
}
