import mongoose, { Schema, type Document, type Model, type Types } from 'mongoose';

export type IngestionStatus = 'processing' | 'completed' | 'failed';
export type EmailValidationStatus = 'pending' | 'valid' | 'invalid' | 'risky' | 'unknown';
export type CrawlStatus = 'not_started' | 'in_progress' | 'completed' | 'failed';
export type SiteType = 'company_website' | 'personal_portfolio' | 'unknown';

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
}

export interface LeadIngestionDocument extends Document {
  clientId: Types.ObjectId;
  rawText: string;
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
  emailStatus: 'draft' | 'sending' | 'sent' | 'failed';
  createdAt: Date;
  updatedAt: Date;
}

const LeadIngestionSchema = new Schema<LeadIngestionDocument>(
  {
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    rawText: { type: String, required: true },
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
    emailStatus: {
      type: String,
      enum: ['draft', 'sending', 'sent', 'failed'],
      default: 'draft',
      index: true,
    },
  },
  { timestamps: true }
);

export const LeadIngestion: Model<LeadIngestionDocument> =
  (mongoose.models.LeadIngestion as Model<LeadIngestionDocument>) ||
  mongoose.model<LeadIngestionDocument>('LeadIngestion', LeadIngestionSchema);
