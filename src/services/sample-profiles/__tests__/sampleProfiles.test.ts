/**
 * @jest-environment node
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { SEED_SAMPLES } from '../samples';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  const { connectToMongoDB } = await import('@/lib/db/connection');
  await connectToMongoDB();
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  const { SampleProfile } = await import('@/lib/db/models/SampleProfile');
  await SampleProfile.deleteMany({});
});

describe('the starter samples', () => {
  it('ships the three profiles, stored exactly as they were pasted', () => {
    expect(SEED_SAMPLES).toHaveLength(3);
    expect(SEED_SAMPLES[0].title).toMatch(/Mark Allen/);
    expect(SEED_SAMPLES[0].content).toContain('DevOps Engineer and Evangelist');
    expect(SEED_SAMPLES[0].content).toContain('Garden Bay, British Columbia, Canada');
    expect(SEED_SAMPLES[1].content).toContain('Shannon Lal');
    expect(SEED_SAMPLES[1].content).toContain('VP Technology and Engineering');
    // The second copy differs only in two follower counts.
    expect(SEED_SAMPLES[2].content).not.toBe(SEED_SAMPLES[1].content);
    expect(SEED_SAMPLES[2].content).toContain('6,864,021 followers');
    expect(SEED_SAMPLES[1].content).toContain('6,864,026 followers');
    for (const sample of SEED_SAMPLES) {
      expect(sample.content.length).toBeGreaterThan(2000);
      expect(sample.content.length).toBeLessThanOrEqual(50_000);
    }
  });
});

describe('listSampleProfiles', () => {
  it('writes the starter samples on the first call and keeps them after that', async () => {
    const { listSampleProfiles } = await import('../sampleProfiles');
    const { SampleProfile } = await import('@/lib/db/models/SampleProfile');

    const first = await listSampleProfiles();
    expect(first).toHaveLength(3);
    expect(first[0].title).toBe(SEED_SAMPLES[0].title);
    expect(first[0].content).toBe(SEED_SAMPLES[0].content);

    const second = await listSampleProfiles();
    expect(second.map((s) => s.id)).toEqual(first.map((s) => s.id));
    expect(await SampleProfile.countDocuments()).toBe(3);
  });

  it('brings the starters back once every sample is deleted', async () => {
    const { listSampleProfiles, deleteSampleProfile } = await import('../sampleProfiles');
    const samples = await listSampleProfiles();
    for (const sample of samples) await deleteSampleProfile(sample.id);

    expect(await listSampleProfiles()).toHaveLength(3);
  });
});

describe('creating, editing and deleting', () => {
  it('saves a new sample', async () => {
    const { createSampleProfile, listSampleProfiles } = await import('../sampleProfiles');
    await listSampleProfiles();

    const created = await createSampleProfile({ title: '  My own paste  ', content: 'Jane Doe\nCTO at Example' });

    expect(created.title).toBe('My own paste');
    const all = await listSampleProfiles();
    expect(all).toHaveLength(4);
    expect(all[all.length - 1].id).toBe(created.id);
  });

  it('edits a sample in place', async () => {
    const { listSampleProfiles, updateSampleProfile } = await import('../sampleProfiles');
    const [first] = await listSampleProfiles();

    const updated = await updateSampleProfile(first.id, { title: 'Renamed', content: 'New text for the sample' });

    expect(updated).toMatchObject({ id: first.id, title: 'Renamed', content: 'New text for the sample' });
    const all = await listSampleProfiles();
    expect(all.find((s) => s.id === first.id)!.title).toBe('Renamed');
  });

  it('deletes a sample', async () => {
    const { listSampleProfiles, deleteSampleProfile } = await import('../sampleProfiles');
    const [first] = await listSampleProfiles();

    await deleteSampleProfile(first.id);

    expect((await listSampleProfiles()).some((s) => s.id === first.id)).toBe(false);
  });

  it('normalises Windows line endings so the text matches what was pasted', async () => {
    const { createSampleProfile } = await import('../sampleProfiles');
    const created = await createSampleProfile({ title: 'CRLF', content: 'line one\r\nline two' });
    expect(created.content).toBe('line one\nline two');
  });
});

describe('validation', () => {
  it('needs a name and some text', async () => {
    const { createSampleProfile, SampleProfileError } = await import('../sampleProfiles');
    await expect(createSampleProfile({ title: '  ', content: 'text' })).rejects.toBeInstanceOf(SampleProfileError);
    await expect(createSampleProfile({ title: 'Name', content: '   ' })).rejects.toBeInstanceOf(SampleProfileError);
  });

  it('refuses a name or text that is too long', async () => {
    const { createSampleProfile, SampleProfileError } = await import('../sampleProfiles');
    await expect(createSampleProfile({ title: 'x'.repeat(121), content: 'text' })).rejects.toBeInstanceOf(SampleProfileError);
    await expect(createSampleProfile({ title: 'Name', content: 'x'.repeat(50_001) })).rejects.toBeInstanceOf(SampleProfileError);
  });

  it('rejects an unknown or malformed id', async () => {
    const { deleteSampleProfile, updateSampleProfile, SampleProfileError } = await import('../sampleProfiles');
    await expect(deleteSampleProfile('nope')).rejects.toBeInstanceOf(SampleProfileError);
    await expect(
      updateSampleProfile(new mongoose.Types.ObjectId().toString(), { title: 'a', content: 'b' })
    ).rejects.toMatchObject({ status: 404 });
  });

  it('caps how many samples can be kept', async () => {
    const { createSampleProfile, SampleProfileError } = await import('../sampleProfiles');
    const { SampleProfile } = await import('@/lib/db/models/SampleProfile');
    await SampleProfile.insertMany(
      Array.from({ length: 50 }, (_, i) => ({ title: `Sample ${i}`, content: 'text' }))
    );

    await expect(createSampleProfile({ title: 'One too many', content: 'text' })).rejects.toBeInstanceOf(
      SampleProfileError
    );
  });
});
