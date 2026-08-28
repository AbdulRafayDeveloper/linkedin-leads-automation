import { render, screen } from '@testing-library/react';
import Sidebar from '../Sidebar';

jest.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}));

describe('Sidebar', () => {
  it('renders all navigation links', () => {
    render(<Sidebar />);
    expect(screen.getAllByText('Dashboard').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Process New Lead').length).toBeGreaterThan(0);
    expect(screen.getAllByText('My Leads').length).toBeGreaterThan(0);
  });

  it('marks the current page as active via aria-current', () => {
    render(<Sidebar />);
    const activeLinks = screen.getAllByText('My Leads').map((el) => el.closest('a'));
    expect(activeLinks.some((link) => link?.getAttribute('aria-current') === 'page')).toBe(true);
  });

  it('links point to the correct routes', () => {
    render(<Sidebar />);
    const processLinks = screen.getAllByText('Process New Lead').map((el) => el.closest('a'));
    expect(processLinks.some((link) => link?.getAttribute('href') === '/process')).toBe(true);
  });
});
