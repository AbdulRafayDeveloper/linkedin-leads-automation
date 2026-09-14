import { renderBrandCard } from '@/lib/brand/ogCard';
import { OG_PAGE_PATHS, pageCardContent } from '@/lib/seo/ogPages';

// Social card for each sidebar page, e.g. /og/lead-ingestion/campaigns.
// All cards are rendered at build time; any other path is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return OG_PAGE_PATHS.map((path) => ({ slug: path.split('/').filter(Boolean) }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  return renderBrandCard(pageCardContent(`/${slug.join('/')}`));
}
