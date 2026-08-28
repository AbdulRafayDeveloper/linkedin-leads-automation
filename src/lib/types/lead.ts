export type EmailSource = 'LINKEDIN' | 'COMPANY_WEBSITE' | 'NOT_FOUND';
export type EmailConfidence = 'HIGH' | 'MEDIUM' | 'LOW';
export type ValidationStatus = 'PASS' | 'FAIL' | 'NEEDS_REVIEW' | 'NOT_FOUND';
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type ProcessingStatus = 'COMPLETE' | 'ERROR';
export type SentStatus = 'NOT_SENT' | 'DRAFT_CREATED' | 'SENT' | 'BOUNCED';
export type CompanyConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export const UNCERTAIN = 'UNCERTAIN' as const;

export interface ParsedLead {
  fullName: string;
  linkedinProfileUrl: string | null;
  headline: string | null;
  currentTitle: string | null;
  currentCompany: string | null;
  currentCompanyLinkedInUrl: string | null;
  currentCompanyWebsite: string | null;
  location: string | null;
  currentRoleStartDate: string | null;
  about: string | null;
  experience: string[];
  education: string[];
  skills: string[];
  recentActivity: string[];
  publicEmail: string | null;
  sourceText: string;
}

export interface CompanyResearchResult {
  companyName: string;
  officialWebsite: string | null;
  confidence: CompanyConfidence;
  description: string | null;
  signals: string[];
  discoveredEmails: string[];
  sourceUrls: string[];
}

export interface EmailDiscoveryResult {
  email: string | null;
  emailSource: EmailSource;
  confidence: EmailConfidence;
  pagesSearched: string[];
  notes: string[];
}

export interface ValidationCheckResult {
  syntax: boolean;
  domainResolves: boolean;
  mxRecordsFound: boolean;
  isDisposable: boolean;
  isRoleEmail: boolean;
}

export interface EmailValidationResult {
  status: ValidationStatus;
  validationChecks: ValidationCheckResult | null;
  reasons: string[];
  confidence: EmailConfidence;
}

export interface GeneratedEmail {
  subject: string;
  body: string;
  personalizationSignalsUsed: string[];
  confidence: EmailConfidence;
  warnings: string[];
}

export interface ProcessingResult {
  lead: ParsedLead;
  company: CompanyResearchResult;
  emailDiscovery: EmailDiscoveryResult;
  validation: EmailValidationResult;
  generatedEmail: GeneratedEmail;
  totalProcessingTimeMs: number;
}

export interface LeadRecord {
  _id: string;
  fullName: string;
  linkedinProfileUrl: string | null;
  headline: string | null;
  currentTitle: string | null;
  currentCompany: string | null;
  currentCompanyLinkedInUrl: string | null;
  currentCompanyWebsite: string | null;
  location: string | null;
  currentRoleStartDate: string | null;
  about: string | null;
  experience: string[];
  education: string[];
  skills: string[];
  recentActivity: string[];
  email: string | null;
  emailSource: EmailSource;
  emailConfidence: EmailConfidence;
  validationStatus: ValidationStatus;
  validationDetails: string | null;
  personalizationSignals: Record<string, unknown>;
  emailSubject: string | null;
  emailBody: string | null;
  approvalStatus: ApprovalStatus;
  processingStatus: ProcessingStatus;
  sentStatus: SentStatus;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  processingTimeMs: number | null;
  sourceText: string | null;
}

export interface PaginatedResult<T> {
  leads: T[];
  total: number;
  page: number;
  pages: number;
}
