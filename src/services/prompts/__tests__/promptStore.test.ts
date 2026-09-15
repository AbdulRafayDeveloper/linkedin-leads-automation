/** @jest-environment node */
jest.mock('@/lib/db/connection', () => ({
  connectToMongoDB: jest.fn().mockResolvedValue(undefined),
}));

const docs: Array<{ key: string; promptText: string; updatedAt: Date }> = [];

jest.mock('@/lib/db/models/PromptSetting', () => ({
  PromptSetting: {
    findOne: jest.fn(({ key }: { key: string }) => Promise.resolve(docs.find((doc) => doc.key === key) ?? null)),
    find: jest.fn(() => Promise.resolve(docs)),
    findOneAndUpdate: jest.fn(({ key }: { key: string }, update: { $set: { promptText: string } }) => {
      const existing = docs.find((doc) => doc.key === key);
      if (existing) existing.promptText = update.$set.promptText;
      else docs.push({ key, promptText: update.$set.promptText, updatedAt: new Date('2026-09-15T10:00:00Z') });
      return Promise.resolve(null);
    }),
  },
}));

import { PROMPT_DEFINITIONS, PROMPT_KEYS, getPromptDefinition } from '../definitions';
import { getPromptText, listPrompts, savePrompt } from '../promptStore';

beforeEach(() => {
  docs.length = 0;
});

describe('prompt definitions', () => {
  it('has unique keys and a default for every prompt', () => {
    const keys = PROMPT_DEFINITIONS.map((definition) => definition.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual([PROMPT_KEYS.emailWriting, PROMPT_KEYS.emailFormat]);
    for (const definition of PROMPT_DEFINITIONS) expect(definition.defaultText.trim()).not.toBe('');
    expect(getPromptDefinition('nope')).toBeUndefined();
  });
});

describe('promptStore', () => {
  it('returns the default until a prompt is saved, then the saved text (even when empty)', async () => {
    const defaultText = getPromptDefinition(PROMPT_KEYS.emailFormat)!.defaultText;
    expect(await getPromptText(PROMPT_KEYS.emailFormat)).toBe(defaultText);

    await savePrompt(PROMPT_KEYS.emailFormat, '  Custom rules  ');
    expect(await getPromptText(PROMPT_KEYS.emailFormat)).toBe('Custom rules');

    await savePrompt(PROMPT_KEYS.emailFormat, '');
    expect(await getPromptText(PROMPT_KEYS.emailFormat)).toBe('');
  });

  it('lists every prompt in order with its saved state', async () => {
    await savePrompt(PROMPT_KEYS.emailWriting, 'I am Abdul Rafay.');
    const prompts = await listPrompts();

    expect(prompts.map((prompt) => prompt.key)).toEqual([PROMPT_KEYS.emailWriting, PROMPT_KEYS.emailFormat]);
    expect(prompts[0]).toMatchObject({
      promptText: 'I am Abdul Rafay.',
      isDefault: false,
      updatedAt: '2026-09-15T10:00:00.000Z',
    });
    expect(prompts[1]).toMatchObject({ isDefault: true, updatedAt: null });
  });
});
