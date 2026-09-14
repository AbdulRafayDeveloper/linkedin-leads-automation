import { render, screen } from '@testing-library/react';
import Sidebar from '../Sidebar';
import { getActiveNav } from '../navigation';

let mockPathname = '/lead-ingestion/emails';

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

function linkFor(label: string) {
  return screen.getByText(label).closest('a');
}

describe('Sidebar', () => {
  beforeEach(() => {
    mockPathname = '/lead-ingestion/emails';
  });

  it('renders every navigation item with its description', () => {
    render(<Sidebar />);
    for (const label of ['Dashboard', 'New Lead', 'Leads', 'Drafts', 'Ready to Send', 'Campaigns', 'AI Settings']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('Review AI emails')).toBeInTheDocument();
  });

  it('links point to the correct routes', () => {
    render(<Sidebar />);
    expect(linkFor('Dashboard')).toHaveAttribute('href', '/dashboard');
    expect(linkFor('New Lead')).toHaveAttribute('href', '/lead-ingestion');
    expect(linkFor('Leads')).toHaveAttribute('href', '/my-leads');
    expect(linkFor('Drafts')).toHaveAttribute('href', '/lead-ingestion/emails');
    expect(linkFor('Ready to Send')).toHaveAttribute('href', '/lead-ingestion/approved');
    expect(linkFor('Campaigns')).toHaveAttribute('href', '/lead-ingestion/campaigns');
    expect(linkFor('AI Settings')).toHaveAttribute('href', '/lead-ingestion/prompt');
  });

  it('marks only the most specific matching item as active', () => {
    render(<Sidebar />);
    expect(linkFor('Drafts')).toHaveAttribute('aria-current', 'page');
    expect(linkFor('New Lead')).not.toHaveAttribute('aria-current');
  });

  it('keeps the parent item active on detail pages', () => {
    mockPathname = '/lead-ingestion/campaigns/abc123';
    render(<Sidebar />);
    expect(linkFor('Campaigns')).toHaveAttribute('aria-current', 'page');
  });

  it('renders the mobile drawer only when open', () => {
    const { rerender } = render(<Sidebar />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    rerender(<Sidebar mobileOpen onMobileClose={() => {}} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('getActiveNav', () => {
  it('maps lead profile pages to Leads', () => {
    expect(getActiveNav('/lead-ingestion/client/xyz')).toMatchObject({
      section: 'Prospecting',
      isDetail: true,
      item: { label: 'Leads' },
    });
  });

  it('returns null for routes outside the navigation', () => {
    expect(getActiveNav('/process')).toBeNull();
  });
});
