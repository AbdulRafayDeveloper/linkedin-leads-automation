import { render, screen } from '@testing-library/react';
import Brand, { BrandMark } from '@/components/sidebar/Brand';
import AppFooter from '../AppFooter';
import NotFound from '@/app/not-found';

describe('Brand', () => {
  it('links the logo, name and tagline to the app home page', () => {
    render(<Brand />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/dashboard');
    expect(link).toHaveTextContent('LeadForge');
    expect(link).toHaveTextContent('AI outreach for LinkedIn leads');
  });
});

describe('BrandMark', () => {
  it('is decorative unless labelled', () => {
    const { container } = render(<BrandMark />);
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('exposes a label as an image and sizes itself in pixels', () => {
    render(<BrandMark size={48} label="LeadForge logo" />);
    const mark = screen.getByRole('img', { name: 'LeadForge logo' });
    expect(mark).toHaveStyle({ width: '48px', height: '48px' });
  });
});

describe('AppFooter', () => {
  it('shows the logo linking home and the copyright', () => {
    render(<AppFooter />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/dashboard');
    expect(screen.getByText(`© ${new Date().getFullYear()} LeadForge`)).toBeInTheDocument();
  });
});

describe('NotFound', () => {
  it('shows a branded 404 with a way back to the dashboard', () => {
    render(<NotFound />);
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to dashboard' })).toHaveAttribute('href', '/dashboard');
  });
});
