import mongoose from 'mongoose';
import { connectToMongoDB } from '@/lib/db/connection';
import { SampleProfile } from '@/lib/db/models/SampleProfile';
import { MAX_PROFILE_CHARS } from '@/lib/validation/ingestionInput';
import { SEED_SAMPLES } from './samples';

export const MAX_TITLE_CHARS = 120;
export const MAX_SAMPLES = 50;

export interface SampleProfileRecord {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
}

export class SampleProfileError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message);
    this.name = 'SampleProfileError';
  }
}

function toRecord(doc: {
  _id: mongoose.Types.ObjectId | string;
  title: string;
  content: string;
  updatedAt: Date;
}): SampleProfileRecord {
  return {
    id: String(doc._id),
    title: doc.title,
    content: doc.content,
    updatedAt: new Date(doc.updatedAt).toISOString(),
  };
}

function clean(input: { title?: string; content?: string }): { title: string; content: string } {
  const title = (input.title ?? '').trim();
  const content = (input.content ?? '').replace(/\r\n/g, '\n');

  if (!title) throw new SampleProfileError('Give this sample a name.');
  if (title.length > MAX_TITLE_CHARS) {
    throw new SampleProfileError(`The name has to be under ${MAX_TITLE_CHARS} characters.`);
  }
  if (!content.trim()) throw new SampleProfileError('Paste the profile text for this sample.');
  if (content.length > MAX_PROFILE_CHARS) {
    throw new SampleProfileError(
      `The text is too long. Keep it under ${MAX_PROFILE_CHARS.toLocaleString('en-US')} characters.`
    );
  }
  return { title, content };
}

/**
 * Every saved sample, oldest first. The three starter samples are written on
 * the first call, and again if the list is ever emptied — deleting them all is
 * how you get the defaults back.
 */
export async function listSampleProfiles(): Promise<SampleProfileRecord[]> {
  await connectToMongoDB();

  const count = await SampleProfile.estimatedDocumentCount();
  if (count === 0) {
    await SampleProfile.insertMany(SEED_SAMPLES, { ordered: false }).catch((error) => {
      // A parallel first load may have seeded already; the read below is the truth.
      console.error('[sample-profiles] seeding failed:', error instanceof Error ? error.message : error);
    });
  }

  const docs = await SampleProfile.find()
    .sort({ createdAt: 1 })
    .lean<{ _id: mongoose.Types.ObjectId; title: string; content: string; updatedAt: Date }[]>();
  return docs.map(toRecord);
}

export async function createSampleProfile(input: {
  title?: string;
  content?: string;
}): Promise<SampleProfileRecord> {
  await connectToMongoDB();
  const { title, content } = clean(input);

  if ((await SampleProfile.estimatedDocumentCount()) >= MAX_SAMPLES) {
    throw new SampleProfileError(`You can keep up to ${MAX_SAMPLES} samples. Delete one first.`, 409);
  }

  const doc = await SampleProfile.create({ title, content });
  return toRecord(doc);
}

export async function updateSampleProfile(
  id: string,
  input: { title?: string; content?: string }
): Promise<SampleProfileRecord> {
  await connectToMongoDB();
  if (!mongoose.Types.ObjectId.isValid(id)) throw new SampleProfileError('Invalid sample id', 400);
  const { title, content } = clean(input);

  const doc = await SampleProfile.findByIdAndUpdate(
    id,
    { $set: { title, content } },
    { returnDocument: 'after', runValidators: true }
  );
  if (!doc) throw new SampleProfileError('That sample no longer exists.', 404);
  return toRecord(doc);
}

export async function deleteSampleProfile(id: string): Promise<void> {
  await connectToMongoDB();
  if (!mongoose.Types.ObjectId.isValid(id)) throw new SampleProfileError('Invalid sample id', 400);

  const doc = await SampleProfile.findByIdAndDelete(id);
  if (!doc) throw new SampleProfileError('That sample no longer exists.', 404);
}
