import { formatSenderSignature, senderProfile, type SenderProfile } from '../senderProfile';

describe('senderProfile', () => {
  it('has non-empty required fields by default', () => {
    expect(senderProfile.name.length).toBeGreaterThan(0);
    expect(senderProfile.title.length).toBeGreaterThan(0);
    expect(senderProfile.portfolioUrl.length).toBeGreaterThan(0);
    expect(senderProfile.linkedinUrl.length).toBeGreaterThan(0);
    expect(senderProfile.phone.length).toBeGreaterThan(0);
  });
});

describe('formatSenderSignature', () => {
  const profile: SenderProfile = {
    name: 'Jane Doe',
    title: 'Engineer',
    positioning: ['builds things'],
    portfolioUrl: 'https://jane.dev',
    linkedinUrl: 'https://linkedin.com/in/jane',
    phone: '+1 555 0100',
  };

  it('includes the sender name and every contact link', () => {
    const signature = formatSenderSignature(profile);
    expect(signature).toContain('Jane Doe');
    expect(signature).toContain('https://jane.dev');
    expect(signature).toContain('https://linkedin.com/in/jane');
    expect(signature).toContain('+1 555 0100');
  });

  it('labels each link clearly', () => {
    const signature = formatSenderSignature(profile);
    expect(signature).toContain('Portfolio:');
    expect(signature).toContain('LinkedIn:');
    expect(signature).toContain('Phone / WhatsApp:');
  });

  it('defaults to the module-level sender profile when none is passed', () => {
    const signature = formatSenderSignature();
    expect(signature).toContain(senderProfile.name);
    expect(signature).toContain(senderProfile.portfolioUrl);
  });
});
