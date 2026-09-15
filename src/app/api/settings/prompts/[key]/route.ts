import { type NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api/response';
import { MAX_PROMPT_LENGTH, getPromptDefinition } from '@/services/prompts/definitions';
import { savePrompt } from '@/services/prompts/promptStore';

interface RouteParams {
  params: Promise<{ key: string }>;
}

/** Saves one prompt. An empty prompt is allowed: it turns that step off. */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { key } = await params;
    const definition = getPromptDefinition(key);
    if (!definition) return jsonError('Unknown prompt', 404);

    const body = (await request.json().catch(() => ({}))) as { promptText?: unknown };
    if (typeof body.promptText !== 'string') return jsonError('promptText must be a string', 400);
    if (body.promptText.length > MAX_PROMPT_LENGTH) {
      return jsonError(`Prompt is too long (max ${MAX_PROMPT_LENGTH.toLocaleString()} characters)`, 400);
    }

    return jsonOk({ prompt: await savePrompt(definition.key, body.promptText) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to save prompt', 500);
  }
}
