import { ImageResponse } from 'next/og';
import { OG_IMAGE_SIZE } from './assets';
import { logoDataUri } from './logo';

// Social preview cards (Open Graph and Twitter) for link shares on LinkedIn,
// X, Slack, WhatsApp, Telegram, Discord and the like, at 1200×630.

const CACHE_CONTROL = 'public, max-age=86400, stale-while-revalidate=604800';

const STEPS = ['Extract profile', 'Find emails', 'Verify SMTP', 'Write with AI', 'Send campaigns'];

export interface PageCardContent {
  /** Sidebar section, e.g. "Outreach". */
  section: string;
  /** Page name, e.g. "Campaigns". */
  title: string;
  /** Short line under the title. */
  description: string;
  /** The page URL without the protocol, e.g. "leadforge.app/dashboard". */
  url: string;
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '72px 80px',
        color: '#ffffff',
        backgroundColor: '#020617',
        backgroundImage:
          'radial-gradient(circle at 90% 0%, rgba(99,102,241,0.45) 0%, rgba(2,6,23,0) 55%), radial-gradient(circle at 0% 100%, rgba(124,58,237,0.28) 0%, rgba(2,6,23,0) 50%)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoDataUri('rounded', 68)} width={68} height={68} alt="LeadForge logo" />
        <div style={{ fontSize: 42, letterSpacing: '-0.02em' }}>LeadForge</div>
      </div>
      {children}
    </div>
  );
}

/** The site-wide card: what LeadForge does and the pipeline steps. */
function SiteCard() {
  return (
    <Frame>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div style={{ fontSize: 66, lineHeight: 1.08, letterSpacing: '-0.035em', maxWidth: 1000 }}>
          Turn LinkedIn profiles into verified leads and personal outreach.
        </div>
        <div style={{ fontSize: 28, lineHeight: 1.4, color: '#94a3b8', maxWidth: 940 }}>
          AI extraction, website crawling, SMTP verification and email campaigns in one workspace.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        {STEPS.map((step, i) => (
          <div
            key={step}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '9px 16px 9px 10px',
              borderRadius: 999,
              border: '1px solid rgba(255,255,255,0.12)',
              backgroundColor: 'rgba(255,255,255,0.05)',
              fontSize: 20,
              color: '#e2e8f0',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 26,
                height: 26,
                borderRadius: 999,
                backgroundColor: 'rgba(129,140,248,0.22)',
                color: '#c7d2fe',
                fontSize: 15,
              }}
            >
              {i + 1}
            </div>
            {step}
          </div>
        ))}
      </div>
    </Frame>
  );
}

/** A card for one page: section, page name, short description and URL. */
function PageCard({ section, title, description, url }: PageCardContent) {
  return (
    <Frame>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ fontSize: 24, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#a5b4fc' }}>
          {section}
        </div>
        <div style={{ fontSize: 104, lineHeight: 1, letterSpacing: '-0.04em', maxWidth: 1040 }}>{title}</div>
        <div style={{ fontSize: 36, lineHeight: 1.3, color: '#94a3b8', maxWidth: 1000 }}>{description}</div>
      </div>

      <div style={{ display: 'flex', fontSize: 24, color: '#cbd5e1' }}>{url}</div>
    </Frame>
  );
}

function render(element: React.ReactElement): ImageResponse {
  return new ImageResponse(element, {
    ...OG_IMAGE_SIZE,
    headers: { 'Cache-Control': CACHE_CONTROL },
  });
}

/**
 * Renders a page's card, or the site-wide card when there is no page content.
 * If the page card fails to render, the site-wide card is returned instead, so
 * a share never shows an empty or broken image.
 */
export async function renderBrandCard(content?: PageCardContent): Promise<Response> {
  if (content) {
    try {
      const response = render(<PageCard {...content} />);
      // ImageResponse renders lazily; read it here so a failure lands in the catch.
      const body = await response.arrayBuffer();
      return new Response(body, { status: response.status, headers: response.headers });
    } catch (error) {
      console.error('Page social card failed, using the site card instead:', error);
    }
  }
  return render(<SiteCard />);
}
