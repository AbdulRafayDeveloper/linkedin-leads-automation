import { parseLeadContent } from '@/lib/parser/parser';
import { researchCompany } from '@/lib/research/research';
import { discoverEmail } from '@/lib/email/discovery';
import { validateEmail } from '@/lib/email/validation';
import { generatePersonalizedEmail } from '@/lib/email/generation';
import { getChatModel } from '@/lib/ai/provider';
import type { ProcessingResult } from '@/lib/types/lead';

export async function processLeadContent(rawContent: string): Promise<ProcessingResult> {
  const startedAt = Date.now();

  const lead = parseLeadContent(rawContent);
  const company = await researchCompany(
    lead.currentCompany ?? 'CURRENT_COMPANY_UNCERTAIN',
    lead.currentCompanyWebsite
  );
  const emailDiscovery = discoverEmail(lead, company);
  const validation = await validateEmail(emailDiscovery.email);

  let generatedEmail;
  try {
    const model = await getChatModel();
    generatedEmail = await generatePersonalizedEmail(lead, company, model);
  } catch {
    generatedEmail = await generatePersonalizedEmail(lead, company);
  }

  return {
    lead,
    company,
    emailDiscovery,
    validation,
    generatedEmail,
    totalProcessingTimeMs: Date.now() - startedAt,
  };
}
