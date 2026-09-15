import { connectToMongoDB } from '@/lib/db/connection';
import { PromptSetting } from '@/lib/db/models/PromptSetting';
import { PROMPT_DEFINITIONS, getPromptDefinition, type PromptKey } from './definitions';

export interface StoredPrompt {
  key: PromptKey;
  title: string;
  description: string;
  stage: string;
  emptyBehavior: string;
  promptText: string;
  defaultText: string;
  /** True until the prompt is saved at least once. */
  isDefault: boolean;
  updatedAt: string | null;
}

/**
 * The saved text of a prompt, or its default when it has never been saved.
 * A prompt saved as empty stays empty (that is how a step is turned off).
 */
export async function getPromptText(key: PromptKey): Promise<string> {
  await connectToMongoDB();
  const doc = await PromptSetting.findOne({ key });
  if (doc) return doc.promptText ?? '';
  return getPromptDefinition(key)?.defaultText ?? '';
}

/** Every editable prompt, in the order of PROMPT_DEFINITIONS. */
export async function listPrompts(): Promise<StoredPrompt[]> {
  await connectToMongoDB();
  const docs = await PromptSetting.find({ key: { $in: PROMPT_DEFINITIONS.map((definition) => definition.key) } });
  const byKey = new Map(docs.map((doc) => [doc.key, doc]));

  return PROMPT_DEFINITIONS.map(({ defaultText, ...definition }) => {
    const doc = byKey.get(definition.key);
    return {
      ...definition,
      defaultText,
      promptText: doc ? doc.promptText ?? '' : defaultText,
      isDefault: !doc,
      updatedAt: doc?.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
    };
  });
}

export async function savePrompt(key: PromptKey, promptText: string): Promise<StoredPrompt> {
  await connectToMongoDB();
  await PromptSetting.findOneAndUpdate(
    { key },
    { $set: { promptText: promptText.trim() } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  const saved = (await listPrompts()).find((prompt) => prompt.key === key);
  if (!saved) throw new Error(`Unknown prompt: ${key}`);
  return saved;
}
