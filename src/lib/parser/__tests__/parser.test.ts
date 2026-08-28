import { parseLeadContent } from '../parser';

const GUS_GOLLINGS_SAMPLE = `
Gus Gollings
Head of Growth at Northwind Robotics
San Francisco, California, United States

About
Gus leads growth initiatives at Northwind Robotics, focused on scaling B2B partnerships and go-to-market strategy for industrial automation products.

Experience
Head of Growth at Northwind Robotics
Senior Growth Marketer at BlueOrbit Analytics
Growth Associate at Fenwick Data Co

Education
University of Michigan - BBA Marketing
Lansing Community College - Associate Degree

Skills
Growth Marketing
B2B Partnerships
Go-To-Market Strategy
SQL

Activity
Posted about scaling outbound sales motions for hardware startups
Commented on a post about industrial automation trends

https://www.linkedin.com/in/gusgollings/
https://www.linkedin.com/company/northwind-robotics/
https://www.northwindrobotics.com
`;

describe('parseLeadContent', () => {
  it('extracts the full name as the first content line', () => {
    const result = parseLeadContent(GUS_GOLLINGS_SAMPLE);
    expect(result.fullName).toBe('Gus Gollings');
  });

  it('extracts current title and company from "X at Y" pattern', () => {
    const result = parseLeadContent(GUS_GOLLINGS_SAMPLE);
    expect(result.currentTitle).toBe('Head of Growth');
    expect(result.currentCompany).toBe('Northwind Robotics');
  });

  it('extracts the LinkedIn profile and company URLs', () => {
    const result = parseLeadContent(GUS_GOLLINGS_SAMPLE);
    expect(result.linkedinProfileUrl).toBe('https://www.linkedin.com/in/gusgollings/');
    expect(result.currentCompanyLinkedInUrl).toBe(
      'https://www.linkedin.com/company/northwind-robotics/'
    );
  });

  it('extracts the company website distinct from LinkedIn URLs', () => {
    const result = parseLeadContent(GUS_GOLLINGS_SAMPLE);
    expect(result.currentCompanyWebsite).toBe('https://www.northwindrobotics.com');
  });

  it('extracts about, experience, education, skills and activity sections', () => {
    const result = parseLeadContent(GUS_GOLLINGS_SAMPLE);
    expect(result.about).toContain('Northwind Robotics');
    expect(result.experience.length).toBeGreaterThanOrEqual(2);
    expect(result.education.length).toBeGreaterThanOrEqual(1);
    expect(result.skills).toContain('Growth Marketing');
    expect(result.recentActivity.length).toBeGreaterThanOrEqual(1);
  });

  it('marks current company as UNCERTAIN-equivalent when it cannot be determined', () => {
    const result = parseLeadContent('Jane Doe\nSoftware Engineer\nSeattle, Washington');
    expect(result.currentCompany).toBe('CURRENT_COMPANY_UNCERTAIN');
  });

  it('does not fabricate a public email when none is present', () => {
    const result = parseLeadContent('Jane Doe\nSoftware Engineer at Acme Corp');
    expect(result.publicEmail).toBeNull();
  });

  it('handles HTML-formatted input and strips tags/entities', () => {
    const html = '<div><h1>Gus Gollings</h1><p>Head of Growth at Northwind Robotics</p></div>&amp;';
    const result = parseLeadContent(html);
    expect(result.fullName).toBe('Gus Gollings');
    expect(result.currentCompany).toBe('Northwind Robotics');
  });

  it('extracts a publicly visible email if present in contact info', () => {
    const withEmail = `${GUS_GOLLINGS_SAMPLE}\nContact Info\ngus.gollings@northwindrobotics.com`;
    const result = parseLeadContent(withEmail);
    expect(result.publicEmail).toBe('gus.gollings@northwindrobotics.com');
  });

  it('does not sweep trailing profile/company URLs into the activity section', () => {
    const result = parseLeadContent(GUS_GOLLINGS_SAMPLE);
    expect(result.recentActivity.every((line) => !/^https?:\/\//.test(line))).toBe(true);
  });

  it('throws on empty content', () => {
    expect(() => parseLeadContent('')).toThrow();
    expect(() => parseLeadContent('   ')).toThrow();
  });
});
