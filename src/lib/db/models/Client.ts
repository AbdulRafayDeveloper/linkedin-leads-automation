import mongoose, { Schema, type Document, type Model } from 'mongoose';

export interface ClientDocument extends Document {
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

const ClientSchema = new Schema<ClientDocument>(
  {
    name: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

export const Client: Model<ClientDocument> =
  (mongoose.models.Client as Model<ClientDocument>) ||
  mongoose.model<ClientDocument>('Client', ClientSchema);
