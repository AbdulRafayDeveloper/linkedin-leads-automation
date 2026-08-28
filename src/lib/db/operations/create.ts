import { connectToMongoDB } from '@/lib/db/connection';
import { Lead, type LeadDocument } from '@/lib/db/models/Lead';
import type { ProcessingResult } from '@/lib/types/lead';

export async function createLead(processingResult: ProcessingResult): Promise<LeadDocument> {
  await connectToMongoDB();

  const { lead, emailDiscovery, validation, generatedEmail, totalProcessingTimeMs } =
    processingResult;

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
  });

  return doc.save();
}
