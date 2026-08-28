import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';
import type {
  ApprovalStatus,
  CrawlStatus,
  EmailConfidence,
  EmailDiscoveryStatus,
  EmailEntrySource,
  EmailEntryValidationStatus,
  EmailSource,
  EmailType,
  EnrichmentStatus,
  ProcessingStatus,
  SentStatus,
  ValidationStatus,
  WebsiteStatus,
} from '@/lib/types/lead';

export interface EmailEntrySubdocument {
  _id: Types.ObjectId;
  email: string;
  source: EmailEntrySource;
  sourceUrl: string | null;
  emailType: EmailType;
  validationStatus: EmailEntryValidationStatus;
  validationDetails: string | null;
  discoveredAt: Date;
  validatedAt: Date | null;
}

export interface LeadDocument extends Document {
  fullName: string;
  linkedinProfileUrl: string | null;
  headline: string | null;
  currentTitle: string | null;
  currentCompany: string | null;
  currentCompanyLinkedInUrl: string | null;
  currentCompanyWebsite: string | null;
  currentCompanyLocation: string | null;
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
  createdAt: Date;
  updatedAt: Date;
  sentAt: Date | null;
  processingTimeMs: number | null;
  sourceText: string | null;
  emails: Types.DocumentArray<EmailEntrySubdocument>;
  websiteStatus: WebsiteStatus;
  crawlStatus: CrawlStatus;
  emailDiscoveryStatus: EmailDiscoveryStatus;
  enrichmentStatus: EnrichmentStatus;
  enrichmentError: string | null;
}

const EmailEntrySchema = new Schema<EmailEntrySubdocument>(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      validate: {
        validator: (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
        message: 'Invalid email format',
      },
    },
    source: {
      type: String,
      enum: ['LEAD_PROFILE', 'COMPANY_WEBSITE'],
      required: true,
    },
    sourceUrl: { type: String, default: null },
    emailType: {
      type: String,
      enum: ['PERSONAL', 'SALES', 'SUPPORT', 'GENERAL', 'HR', 'PRESS', 'LEGAL', 'UNKNOWN'],
      default: 'UNKNOWN',
    },
    validationStatus: {
      type: String,
      enum: ['pending', 'valid', 'invalid', 'unknown', 'risky'],
      default: 'pending',
    },
    validationDetails: { type: String, default: null },
    discoveredAt: { type: Date, default: () => new Date() },
    validatedAt: { type: Date, default: null },
  },
  { _id: true }
);

const LeadSchema = new Schema<LeadDocument>(
  {
    fullName: { type: String, required: true, trim: true },
    linkedinProfileUrl: { type: String, default: null },
    headline: { type: String, default: null },
    currentTitle: { type: String, default: null },
    currentCompany: { type: String, required: true, trim: true },
    currentCompanyLinkedInUrl: { type: String, default: null },
    currentCompanyWebsite: { type: String, default: null },
    currentCompanyLocation: { type: String, default: null },
    location: { type: String, default: null },
    currentRoleStartDate: { type: String, default: null },

    about: { type: String, default: null },
    experience: { type: [String], default: [] },
    education: { type: [String], default: [] },
    skills: { type: [String], default: [] },
    recentActivity: { type: [String], default: [] },

    email: {
      type: String,
      default: null,
      validate: {
        validator: (value: string | null) =>
          value === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
        message: 'Invalid email format',
      },
    },
    emailSource: {
      type: String,
      enum: ['LINKEDIN', 'COMPANY_WEBSITE', 'NOT_FOUND'],
      default: 'NOT_FOUND',
    },
    emailConfidence: {
      type: String,
      enum: ['HIGH', 'MEDIUM', 'LOW'],
      default: 'LOW',
    },
    validationStatus: {
      type: String,
      enum: ['PASS', 'FAIL', 'NEEDS_REVIEW', 'NOT_FOUND'],
      default: 'NOT_FOUND',
    },
    validationDetails: { type: String, default: null },

    personalizationSignals: { type: Schema.Types.Mixed, default: {} },

    emailSubject: { type: String, default: null },
    emailBody: { type: String, default: null },

    approvalStatus: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING',
      index: true,
    },
    processingStatus: {
      type: String,
      enum: ['COMPLETE', 'ERROR'],
      default: 'COMPLETE',
    },
    sentStatus: {
      type: String,
      enum: ['NOT_SENT', 'DRAFT_CREATED', 'SENT', 'BOUNCED'],
      default: 'NOT_SENT',
      index: true,
    },
    errorMessage: { type: String, default: null },

    sentAt: { type: Date, default: null },
    processingTimeMs: { type: Number, default: null },
    sourceText: { type: String, default: null },

    emails: { type: [EmailEntrySchema], default: [] },
    websiteStatus: {
      type: String,
      enum: ['not_started', 'found', 'not_found'],
      default: 'not_started',
    },
    crawlStatus: {
      type: String,
      enum: ['not_started', 'in_progress', 'completed', 'failed', 'skipped'],
      default: 'not_started',
    },
    emailDiscoveryStatus: {
      type: String,
      enum: ['not_started', 'in_progress', 'emails_found', 'no_emails_found', 'failed'],
      default: 'not_started',
    },
    enrichmentStatus: {
      type: String,
      enum: [
        'QUEUED',
        'IDENTIFYING_COMPANY',
        'FINDING_WEBSITE',
        'CRAWLING',
        'EXTRACTING',
        'VALIDATING',
        'COMPLETED',
        'FAILED',
      ],
      default: 'QUEUED',
      index: true,
    },
    enrichmentError: { type: String, default: null },
  },
  { timestamps: true }
);

LeadSchema.index({ email: 1 }, { sparse: true });
LeadSchema.index({ validationStatus: 1 });
LeadSchema.index({ createdAt: -1 });
LeadSchema.index({ 'emails.email': 1 });

export const Lead: Model<LeadDocument> =
  (mongoose.models.Lead as Model<LeadDocument>) ||
  mongoose.model<LeadDocument>('Lead', LeadSchema);
