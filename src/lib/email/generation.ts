import type { CompanyResearchResult, GeneratedEmail, ParsedLead } from '@/lib/types/lead';

const MAX_SUBJECT_LENGTH = 350;

export interface EmailGeneratorModel {
  invoke: (prompt: string) => Promise<{ content: unknown } | string>;
}

function firstNameOf(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed || trimmed === 'UNCERTAIN') return 'there';
  return trimmed.split(/\s+/)[0];
}

function collectSignals(lead: ParsedLead, company: CompanyResearchResult): string[] {
  const signals: string[] = [];
  if (lead.currentTitle) signals.push(`current title: ${lead.currentTitle}`);
  if (lead.currentCompany && lead.currentCompany !== 'CURRENT_COMPANY_UNCERTAIN') {
    signals.push(`current company: ${lead.currentCompany}`);
  }
  if (lead.about) signals.push(`about section: ${lead.about}`);
  if (lead.experience.length) signals.push(`experience: ${lead.experience.join('; ')}`);
  if (lead.skills.length) signals.push(`skills: ${lead.skills.join(', ')}`);
  if (lead.recentActivity.length) signals.push(`recent activity: ${lead.recentActivity.join('; ')}`);
  if (company.description) signals.push(`company description: ${company.description}`);
  if (company.signals.length) signals.push(...company.signals);
  return signals;
}

function buildPrompt(lead: ParsedLead, company: CompanyResearchResult, signals: string[]): string {
  return `You are writing a short, personalized cold outreach email.

Recipient first name: ${firstNameOf(lead.fullName)}

Only use the following verified facts. Never invent details not listed here:
${signals.length ? signals.map((s) => `- ${s}`).join('\n') : '- (no additional signals available; keep the email general but still personalized by name and role)'}

Writing rules (follow exactly):
- Subject line: maximum 350 characters, compelling, no dashes or em-dashes.
- Body: minimal commas (only for genuine lists), no abbreviations or shortforms, no dashes or em-dashes, seamless and natural language.
- Body must start with the recipient's first name.
- Do not fabricate any claim, activity, or detail not present in the verified facts above.

Respond ONLY with strict JSON in this exact shape:
{"subject": "...", "body": "...", "personalizationSignalsUsed": ["..."]}`;
}

function stripDashes(text: string): string {
  return text
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/(?<=\S)\s-\s(?=\S)/g, ', ')
    .replace(/,\s*,/g, ',')
    .trim();
}

function ensureStartsWithFirstName(body: string, firstName: string): string {
  const trimmed = body.trim();
  if (trimmed.toLowerCase().startsWith(firstName.toLowerCase())) return trimmed;
  return `${firstName}, ${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1)}`;
}

function extractContent(raw: { content: unknown } | string): string {
  if (typeof raw === 'string') return raw;
  const { content } = raw;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : (part as { text?: string }).text || ''))
      .join('');
  }
  return '';
}

function buildFallbackEmail(lead: ParsedLead, signalsUsed: string[]): GeneratedEmail {
  const firstName = firstNameOf(lead.fullName);
  const companyPhrase =
    lead.currentCompany && lead.currentCompany !== 'CURRENT_COMPANY_UNCERTAIN'
      ? ` at ${lead.currentCompany}`
      : '';
  const titlePhrase = lead.currentTitle ? ` as ${lead.currentTitle}` : '';

  const subject = stripDashes(
    `Quick question about your work${titlePhrase}${companyPhrase}`
  ).slice(0, MAX_SUBJECT_LENGTH);

  const body = ensureStartsWithFirstName(
    stripDashes(
      `${firstName}, I came across your profile${titlePhrase}${companyPhrase} and wanted to reach out. I would love to learn more about the work you are doing and share how we might be able to help. Would you be open to a short conversation.`
    ),
    firstName
  );

  return {
    subject,
    body,
    personalizationSignalsUsed: signalsUsed,
    confidence: signalsUsed.length > 0 ? 'MEDIUM' : 'LOW',
    warnings: ['AI generation unavailable; used deterministic template fallback'],
  };
}

export async function generatePersonalizedEmail(
  lead: ParsedLead,
  company: CompanyResearchResult,
  model?: EmailGeneratorModel
): Promise<GeneratedEmail> {
  const signals = collectSignals(lead, company);
  const firstName = firstNameOf(lead.fullName);

  if (!model) {
    return buildFallbackEmail(lead, signals);
  }

  try {
    const prompt = buildPrompt(lead, company, signals);
    const response = await model.invoke(prompt);
    const raw = extractContent(response);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Model did not return JSON');

    const parsed = JSON.parse(jsonMatch[0]) as {
      subject: string;
      body: string;
      personalizationSignalsUsed?: string[];
    };

    const warnings: string[] = [];
    let subject = stripDashes(parsed.subject || '');
    if (subject.length > MAX_SUBJECT_LENGTH) {
      subject = subject.slice(0, MAX_SUBJECT_LENGTH);
      warnings.push('Subject was truncated to 350 characters');
    }

    const body = ensureStartsWithFirstName(stripDashes(parsed.body || ''), firstName);

    if (!subject || !body) {
      throw new Error('Model returned an incomplete email');
    }

    return {
      subject,
      body,
      personalizationSignalsUsed: parsed.personalizationSignalsUsed?.length
        ? parsed.personalizationSignalsUsed
        : signals,
      confidence: signals.length > 0 ? 'HIGH' : 'MEDIUM',
      warnings,
    };
  } catch (error) {
    const fallback = buildFallbackEmail(lead, signals);
    fallback.warnings.push(
      `AI generation failed: ${error instanceof Error ? error.message : 'unknown error'}`
    );
    return fallback;
  }
}
