import mongoose, { Schema, type Document, type Model } from 'mongoose';

/**
 * A saved block of profile text for testing the New Lead page: paste it in with
 * one click instead of hunting for a LinkedIn profile to copy.
 */
export interface SampleProfileDocument extends Document {
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

const SampleProfileSchema = new Schema<SampleProfileDocument>(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    content: { type: String, required: true, maxlength: 50_000 },
  },
  { timestamps: true }
);

SampleProfileSchema.index({ createdAt: 1 });

export const SampleProfile: Model<SampleProfileDocument> =
  (mongoose.models.SampleProfile as Model<SampleProfileDocument>) ||
  mongoose.model<SampleProfileDocument>('SampleProfile', SampleProfileSchema);
