import { connectToMongoDB } from '@/lib/db/connection';
import { Lead, type LeadDocument } from '@/lib/db/models/Lead';
import { classifyEmailType } from '@/lib/email/emailUtils';
import { mapValidationStatusToEntryStatus } from '@/lib/email/validation';
import type { EmailEntry, ProcessingResult } from '@/lib/types/lead';

export async function createLead(processingResult: ProcessingResult): Promise<LeadDocument> {
  await connectToMongoDB();

  const { lead, emailDiscovery, validation, generatedEmail, totalProcessingTimeMs } =
    processingResult;

  const initialEmails: EmailEntry[] = emailDiscovery.email
    ? [
        {
          email: emailDiscovery.email,
          source: emailDiscovery.emailSource === 'LINKEDIN' ? 'LEAD_PROFILE' : 'COMPANY_WEBSITE',
          sourceUrl: null,
          emailType: classifyEmailType(emailDiscovery.email),
          validationStatus: mapValidationStatusToEntryStatus(validation.status),
          validationDetails: JSON.stringify({
            checks: validation.validationChecks,
            reasons: validation.reasons,
          }),
          discoveredAt: new Date().toISOString(),
          validatedAt: new Date().toISOString(),
        },
      ]
    : [];

  const doc = new Lead({
    fullName: lead.fullName,
    linkedinProfileUrl: lead.linkedinProfileUrl,
    headline: lead.headline,
    currentTitle: lead.currentTitle,
    currentCompany: lead.currentCompany,
    currentCompanyLinkedInUrl: lead.currentCompanyLinkedInUrl,
    currentCompanyWebsite: lead.currentCompanyWebsite,
    location: lead.location,
    currentRoleStartDate: lead.currentRoleStartDate,
    about: lead.about,
    experience: lead.experience,
    education: lead.education,
    skills: lead.skills,
    recentActivity: lead.recentActivity,
    email: emailDiscovery.email,
    emailSource: emailDiscovery.emailSource,
    emailConfidence: emailDiscovery.confidence,
    validationStatus: validation.status,
    validationDetails: JSON.stringify({
      checks: validation.validationChecks,
      reasons: validation.reasons,
    }),
    personalizationSignals: { signals: generatedEmail.personalizationSignalsUsed },
    emailSubject: generatedEmail.subject,
    emailBody: generatedEmail.body,
    approvalStatus: 'PENDING',
    processingStatus: 'COMPLETE',
    sentStatus: 'NOT_SENT',
    processingTimeMs: totalProcessingTimeMs,
    sourceText: lead.sourceText,
    emails: initialEmails,
    websiteStatus: 'not_started',
    crawlStatus: 'not_started',
    emailDiscoveryStatus: initialEmails.length > 0 ? 'emails_found' : 'not_started',
    enrichmentStatus: 'QUEUED',
  });

  return doc.save();
}
