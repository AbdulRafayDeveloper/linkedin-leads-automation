import mongoose, { Schema, type Document, type Model } from 'mongoose';

/**
 * One editable AI prompt, stored under its key (see src/services/prompts/definitions.ts).
 * A prompt that has never been saved has no document and uses its default text.
 */
export interface PromptSettingDocument extends Document {
  key: string;
  promptText: string;
  updatedAt: Date;
  createdAt: Date;
}

const PromptSettingSchema = new Schema<PromptSettingDocument>(
  {
    key: { type: String, required: true, unique: true },
    promptText: { type: String, default: '' },
  },
  { timestamps: true }
);

export const PromptSetting: Model<PromptSettingDocument> =
  (mongoose.models.PromptSetting as Model<PromptSettingDocument>) ||
  mongoose.model<PromptSettingDocument>('PromptSetting', PromptSettingSchema);
