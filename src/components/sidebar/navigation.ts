import type { ComponentType } from 'react';
import {
  ChartIcon,
  CheckCircleIcon,
  MailIcon,
  PlusCircleIcon,
  SendIcon,
  SlidersIcon,
  UsersIcon,
  type IconProps,
} from '@/components/ui/Icons';

export interface NavItem {
  href: string;
  label: string;
  description: string;
  icon: ComponentType<IconProps>;
  /** Other route prefixes that belong to this item, e.g. detail pages. */
  matches?: string[];
  /** Breadcrumb label shown on this item's detail pages. */
  detailLabel?: string;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Overview',
    items: [
      {
        href: '/dashboard',
        label: 'Dashboard',
        description: 'Stats and trends',
        icon: ChartIcon,
      },
    ],
  },
  {
    label: 'Prospecting',
    items: [
      {
        href: '/lead-ingestion',
        label: 'New Lead',
        description: 'Import a profile',
        icon: PlusCircleIcon,
      },
      {
        href: '/my-leads',
        label: 'Leads',
        description: 'All prospects',
        icon: UsersIcon,
        matches: ['/lead-ingestion/client'],
        detailLabel: 'Profile',
      },
    ],
  },
  {
    label: 'Outreach',
    items: [
      {
        href: '/lead-ingestion/emails',
        label: 'Drafts',
        description: 'Review AI emails',
        icon: MailIcon,
      },
      {
        href: '/lead-ingestion/approved',
        label: 'Ready to Send',
        description: 'Approved, not sent',
        icon: CheckCircleIcon,
      },
      {
        href: '/lead-ingestion/campaigns',
        label: 'Campaigns',
        description: 'Send and track',
        icon: SendIcon,
        detailLabel: 'Campaign',
      },
    ],
  },
];

export const SETTINGS_ITEM: NavItem = {
  href: '/lead-ingestion/prompt',
  label: 'AI Settings',
  description: 'Email prompts',
  icon: SlidersIcon,
};

const ALL_ITEMS: { item: NavItem; section: string }[] = [
  ...NAV_SECTIONS.flatMap((section) =>
    section.items.map((item) => ({ item, section: section.label }))
  ),
  { item: SETTINGS_ITEM, section: 'Workspace' },
];

function matchLength(pathname: string, prefix: string): number {
  return pathname === prefix || pathname.startsWith(`${prefix}/`) ? prefix.length : 0;
}

export interface ActiveNav {
  item: NavItem;
  section: string;
  /** True when on a page below the item's own route (e.g. /campaigns/[id]). */
  isDetail: boolean;
}

/**
 * Resolves the nav item for a pathname by longest matching prefix, so
 * `/lead-ingestion/emails` maps to Drafts rather than New Lead.
 */
export function getActiveNav(pathname: string): ActiveNav | null {
  let best: ActiveNav | null = null;
  let bestLength = 0;

  for (const { item, section } of ALL_ITEMS) {
    for (const prefix of [item.href, ...(item.matches ?? [])]) {
      const length = matchLength(pathname, prefix);
      if (length > bestLength) {
        bestLength = length;
        best = { item, section, isDetail: pathname !== item.href };
      }
    }
  }

  return best;
}
