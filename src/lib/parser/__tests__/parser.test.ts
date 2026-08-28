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

// A real Sales Navigator lead page dump: nav chrome, a repeated tab strip
// ("About / Relationship / Experience") before the real section headers, and
// no URLs at all. This is the shape the parser sees in production.
const HARLEY_SALES_NAV_SAMPLE = `Home
Accounts
Leads
Smart Links
Messaging
Actions List
Referrals

7
7 new notifications

Abdul Rafay Full Stack AI DeveloperAbdul Rafay Full Stack AI Developer’s profile picture
Search
Search
Search
Lead filters
Account filters

Saved searches

Personas


Sales Navigator Lead Page
Basic lead information for Harley T.

’s profile picture
Harley T.
3rd
Viewed: 8/28/2026
CTO at Trust Provenance
Adelaide, South Australia, Australia
289 connections

Save

Message

Current role
Trust Provenance
Chief Technology Officer at Trust Provenance

May 2021–Present  5 yrs 4 mos

No job description

Also worked at Boeing See more

Contact information

Add contact info
Search on Bing


Lead IQNew
About
Relationship
Experience
Get insights about Harley
BETA
View personalized AI powered insights based on Harley’s profile and activity. Learn more


Generate Lead IQ
About
I am CTO at Trust Provenance, building infrastructure that lets supply chain clai … Show more
Relationship
You and Harley don’t share anything in common on LinkedIn. Search for leads at Trust Provenance instead.

Search leads
Harley’s experience
Harley has worked for 2 different companies over their professional career

Trust Provenance
Chief Technology Officer
Trust Provenance

May 2021–Present  5 yrs 4 mos

Adelaide, South Australia, Australia

Boeing
Data Engineer
Boeing

Nov 2018–Apr 2021  2 yrs 6 mos

Adelaide, South Australia, Australia

In November 2018 I had the pleasure to begin employment at Boeing Defence Australia within their Data Analytics capability. Here I conducted a significant refactoring of Boeing Maintenance Workflow Analytics (BMWA), to improve maintainability and enable future growth of the product. This body of work resulted in more customer engagements within the business, and I was awarded a Boeing Wirraway Award along with my teamma … Show more
Education
University of Adelaide
University of Adelaide
Bachelor of Computer Science (Advanced, Major in Data Science) Computer Science

2016 – 2020

Interests
Australian Trade and Investment Commission (Austrade)’s logo
Australian Trade and Investment Commission (Austrade)
205,529 followers

Google’s logo
Google
42,340,724 followers

See all interests
Featured skills and endorsements
Data Analysis

1 endorsement
Applied Machine Learning

1 endorsement
Docker

1 endorsement

Show all skills
Lead actions panel
Lists (0)

Save
Add to a list to help organize leads and get alerts

Notes (0)

Add
Add notes to remember key details about Harley

Timeline
Your past history with Harley and key events

You have no previous activity with Harley

Save Harley to get alerts and stay informed of changes and updates

0 notifications total

Chat with us`;

describe('parseLeadContent — real Sales Navigator dump', () => {
  it('extracts the lead name from the "Basic lead information for X" anchor, ignoring nav chrome', () => {
    const result = parseLeadContent(HARLEY_SALES_NAV_SAMPLE);
    expect(result.fullName).toBe('Harley T.');
  });

  it('extracts title and company even with a duplicate "Current role" section later', () => {
    const result = parseLeadContent(HARLEY_SALES_NAV_SAMPLE);
    expect(result.currentTitle).toBe('CTO');
    expect(result.currentCompany).toBe('Trust Provenance');
  });

  it('picks the real About paragraph over the tab-bar label of the same name', () => {
    const result = parseLeadContent(HARLEY_SALES_NAV_SAMPLE);
    expect(result.about).toContain('building infrastructure');
    expect(result.about).not.toBe('Relationship');
  });

  it('finds experience under a "<Name>\'s experience" header instead of the bare Experience tab', () => {
    const result = parseLeadContent(HARLEY_SALES_NAV_SAMPLE);
    expect(result.experience.some((line) => line.includes('Boeing'))).toBe(true);
    expect(result.experience.some((line) => line.includes('Trust Provenance'))).toBe(true);
  });

  it('stops the education section at the Interests header instead of consuming the rest of the page', () => {
    const result = parseLeadContent(HARLEY_SALES_NAV_SAMPLE);
    expect(result.education).toEqual([
      'University of Adelaide',
      'University of Adelaide',
      'Bachelor of Computer Science (Advanced, Major in Data Science) Computer Science',
      '2016 – 2020',
    ]);
  });

  it('extracts skills from "Featured skills and endorsements" without endorsement-count noise', () => {
    const result = parseLeadContent(HARLEY_SALES_NAV_SAMPLE);
    expect(result.skills).toEqual(['Data Analysis', 'Applied Machine Learning', 'Docker']);
  });

  it('does not fabricate an email, LinkedIn URL, or website when none are present', () => {
    const result = parseLeadContent(HARLEY_SALES_NAV_SAMPLE);
    expect(result.publicEmail).toBeNull();
    expect(result.linkedinProfileUrl).toBeNull();
    expect(result.currentCompanyWebsite).toBeNull();
  });
});
