import { discoverEmail } from '../discovery';
import type { CompanyResearchResult } from '@/lib/types/lead';

function baseCompany(overrides: Partial<CompanyResearchResult> = {}): CompanyResearchResult {
  return {
    companyName: 'Northwind Robotics',
    officialWebsite: null,
    confidence: 'LOW',
    description: null,
    signals: [],
    discoveredEmails: [],
    sourceUrls: [],
    ...overrides,
  };
}

describe('discoverEmail', () => {
  it('prefers the Sales Navigator email when present', () => {
    const result = discoverEmail({ publicEmail: 'gus@northwindrobotics.com' }, baseCompany());
    expect(result.email).toBe('gus@northwindrobotics.com');
    expect(result.emailSource).toBe('LINKEDIN');
    expect(result.confidence).toBe('HIGH');
  });

  it('falls back to a company website email when no profile email exists', () => {
    const company = baseCompany({
      discoveredEmails: ['hello@northwindrobotics.com'],
      sourceUrls: ['https://www.northwindrobotics.com'],
      confidence: 'HIGH',
    });
    const result = discoverEmail({ publicEmail: null }, company);
    expect(result.email).toBe('hello@northwindrobotics.com');
    expect(result.emailSource).toBe('COMPANY_WEBSITE');
  });

  it('returns NOT_FOUND when no email exists anywhere', () => {
    const result = discoverEmail({ publicEmail: null }, baseCompany());
    expect(result.email).toBeNull();
    expect(result.emailSource).toBe('NOT_FOUND');
  });

  it('lowers confidence to MEDIUM when company confidence was HIGH but email is inferred', () => {
    const company = baseCompany({
      discoveredEmails: ['sales@northwindrobotics.com'],
      confidence: 'HIGH',
    });
    const result = discoverEmail({ publicEmail: null }, company);
    expect(result.confidence).toBe('MEDIUM');
  });

  it('lowers confidence to LOW when company confidence was not HIGH', () => {
    const company = baseCompany({
      discoveredEmails: ['sales@example.com'],
      confidence: 'MEDIUM',
    });
    const result = discoverEmail({ publicEmail: null }, company);
    expect(result.confidence).toBe('LOW');
  });

  it('records pages searched from company research', () => {
    const company = baseCompany({ sourceUrls: ['https://a.com', 'https://a.com/contact'] });
    const result = discoverEmail({ publicEmail: null }, company);
    expect(result.pagesSearched).toEqual(['https://a.com', 'https://a.com/contact']);
  });

  it('never invents an email address', () => {
    const result = discoverEmail({ publicEmail: null }, baseCompany());
    expect(result.email).toBeNull();
  });
});
