import { isAllowedByRobots } from '../robots';

describe('isAllowedByRobots', () => {
  it('allows everything when robots.txt is missing', () => {
    expect(isAllowedByRobots(null, '/contact', 'LeadResearchBot')).toBe(true);
  });

  it('allows everything when robots.txt has no matching rules', () => {
    const robots = 'User-agent: *\n';
    expect(isAllowedByRobots(robots, '/contact', 'LeadResearchBot')).toBe(true);
  });

  it('disallows a path blocked for all user agents', () => {
    const robots = 'User-agent: *\nDisallow: /admin\n';
    expect(isAllowedByRobots(robots, '/admin/settings', 'LeadResearchBot')).toBe(false);
    expect(isAllowedByRobots(robots, '/contact', 'LeadResearchBot')).toBe(true);
  });

  it('prefers a more specific Allow rule over a broader Disallow', () => {
    const robots = 'User-agent: *\nDisallow: /private\nAllow: /private/public-page\n';
    expect(isAllowedByRobots(robots, '/private/secret', 'LeadResearchBot')).toBe(false);
    expect(isAllowedByRobots(robots, '/private/public-page', 'LeadResearchBot')).toBe(true);
  });

  it('supports wildcard patterns', () => {
    const robots = 'User-agent: *\nDisallow: /*.pdf$\n';
    expect(isAllowedByRobots(robots, '/files/report.pdf', 'LeadResearchBot')).toBe(false);
    expect(isAllowedByRobots(robots, '/files/report.pdf.html', 'LeadResearchBot')).toBe(true);
  });

  it('a blanket "Disallow: /" blocks the entire site for that agent', () => {
    const robots = 'User-agent: *\nDisallow: /\n';
    expect(isAllowedByRobots(robots, '/', 'LeadResearchBot')).toBe(false);
    expect(isAllowedByRobots(robots, '/anything', 'LeadResearchBot')).toBe(false);
  });

  it('applies a specific user-agent group over the wildcard group', () => {
    const robots = 'User-agent: BadBot\nDisallow: /\n\nUser-agent: *\nDisallow:\n';
    expect(isAllowedByRobots(robots, '/contact', 'LeadResearchBot')).toBe(true);
  });
});
