import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';

export type IngestionStatus = 'processing' | 'completed' | 'failed';
export type EmailValidationStatus = 'pending' | 'valid' | 'invalid' | 'risky' | 'unknown';
export type CrawlStatus = 'not_started' | 'in_progress' | 'completed' | 'failed';
export type SiteType = 'company_website' | 'personal_portfolio' | 'unknown';
/** Where the automatic pipeline has got to. Set by the server-side runner. */
export type PipelineStage =
  | 'extracted'
  | 'mapping'
  | 'crawling'
  | 'verifying'
  | 'generating'
  | 'done'
  | 'failed';
export type ExtractionSource = 'ai' | 'regex_fallback';

export interface VerifiedEmailItem {
  email: string;
  status: EmailValidationStatus;
}

export interface CurrentCompanyItem {
  companyName: string;
  jobTitle: string;
  workPeriod: string | null;
  websiteUrl: string | null;
  summary: string;
  companyEmails?: string[];
  emailSubject?: string | null;
  emailBody?: string | null;
  approved?: boolean;
  inCampaign?: boolean;
  campaignSendStatus?: 'pending' | 'sending' | 'delivered' | 'opened' | 'failed' | 'in_progress';
}

export interface LeadIngestionDocument extends Document {
  clientId: Types.ObjectId;
  rawText: string;
  /** SHA-256 of the trimmed pasted text, used to spot a profile pasted twice. */
  rawTextHash: string | null;
  /** 'regex_fallback' means every AI model failed and the data is thin. */
  extractionSource: ExtractionSource;
  pipelineStage: PipelineStage;
  /** Set while a server run owns this lead; a stale value means the run died. */
  pipelineStartedAt: Date | null;
  pipelineError: string | null;
  summary: string | null;
  fullName: string | null;
  companyName: string | null;
  jobTitle: string | null;
  workPeriod: string | null;
  email: string | null;
  phoneNumber: string | null;
  websiteUrl: string | null;
  portfolioUrl: string | null;
  siteType: SiteType;
  additionalUrls: string[];
  currentCompanies: CurrentCompanyItem[];
  status: IngestionStatus;
  discoveredEmails: string[];
  discoveredPhones: string[];
  verifiedEmails: VerifiedEmailItem[];
  emailValidationStatus: EmailValidationStatus;
  emailValidationDetails: string | null;
  crawlStatus: CrawlStatus;
  emailSubject: string | null;
  emailBody: string | null;
  approved: boolean;
  inCampaign?: boolean;
  campaignSendStatus?: 'pending' | 'sending' | 'delivered' | 'opened' | 'failed' | 'in_progress';
  emailStatus: 'pending' | 'in_progress' | 'delivered' | 'opened' | 'failed' | 'no_contact_email';
  createdAt: Date;
  updatedAt: Date;
}

const LeadIngestionSchema = new Schema<LeadIngestionDocument>(
  {
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    rawText: { type: String, required: true },
    rawTextHash: { type: String, default: null, index: true },
    extractionSource: { type: String, enum: ['ai', 'regex_fallback'], default: 'ai' },
    pipelineStage: {
      type: String,
      enum: ['extracted', 'mapping', 'crawling', 'verifying', 'generating', 'done', 'failed'],
      default: 'extracted',
      index: true,
    },
    pipelineStartedAt: { type: Date, default: null },
    pipelineError: { type: String, default: null },
    summary: { type: String, default: null },
    fullName: { type: String, default: null },
    companyName: { type: String, default: null },
    jobTitle: { type: String, default: null },
    workPeriod: { type: String, default: null },
    email: {
      type: String,
      default: null,
      lowercase: true,
      trim: true,
    },
    phoneNumber: { type: String, default: null },
    websiteUrl: { type: String, default: null },
    portfolioUrl: { type: String, default: null },
    siteType: {
      type: String,
      enum: ['company_website', 'personal_portfolio', 'unknown'],
      default: 'unknown',
    },
    additionalUrls: { type: [String], default: [] },
    currentCompanies: {
      type: [
        {
          companyName: { type: String, default: 'Unspecified Company' },
          jobTitle: { type: String, default: 'Professional' },
          workPeriod: { type: String, default: null },
          websiteUrl: { type: String, default: null },
          summary: { type: String, default: '' },
          companyEmails: { type: [String], default: [] },
          emailSubject: { type: String, default: null },
          emailBody: { type: String, default: null },
          approved: { type: Boolean, default: false },
          inCampaign: { type: Boolean, default: false },
          campaignSendStatus: { type: String, default: null },
        },
      ],
      default: [],
    },
    status: {
      type: String,
      enum: ['processing', 'completed', 'failed'],
      default: 'processing',
      index: true,
    },
    discoveredEmails: { type: [String], default: [] },
    discoveredPhones: { type: [String], default: [] },
    verifiedEmails: {
      type: [
        {
          email: { type: String, required: true },
          status: {
            type: String,
            enum: ['pending', 'valid', 'invalid', 'risky', 'unknown'],
            default: 'pending',
          },
        },
      ],
      default: [],
    },
    emailValidationStatus: {
      type: String,
      enum: ['pending', 'valid', 'invalid', 'risky', 'unknown'],
      default: 'pending',
    },
    emailValidationDetails: { type: String, default: null },
    crawlStatus: {
      type: String,
      enum: ['not_started', 'in_progress', 'completed', 'failed'],
      default: 'not_started',
    },
    emailSubject: { type: String, default: null },
    emailBody: { type: String, default: null },
    approved: { type: Boolean, default: false },
    inCampaign: { type: Boolean, default: false },
    campaignSendStatus: { type: String, default: null },
    emailStatus: {
      type: String,
      enum: ['pending', 'in_progress', 'delivered', 'opened', 'failed', 'no_contact_email'],
      default: 'pending',
      index: true,
    },
  },
  { timestamps: true }
);

// The lead list sorts newest first on every page, with or without a filter.
LeadIngestionSchema.index({ createdAt: -1 });
LeadIngestionSchema.index({ fullName: 1, companyName: 1 });
LeadIngestionSchema.index({ clientId: 1, createdAt: -1 });
LeadIngestionSchema.index({ approved: 1, emailValidationStatus: 1 });
LeadIngestionSchema.index({ 'currentCompanies.companyName': 1 });
LeadIngestionSchema.index({ 'currentCompanies.companyEmails': 1 });
LeadIngestionSchema.index({ discoveredEmails: 1 });

export const LeadIngestion: Model<LeadIngestionDocument> =
  (mongoose.models.LeadIngestion as Model<LeadIngestionDocument>) ||
  mongoose.model<LeadIngestionDocument>('LeadIngestion', LeadIngestionSchema);
