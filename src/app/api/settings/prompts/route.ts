import { jsonError, jsonOk } from '@/lib/api/response';
import { listPrompts } from '@/services/prompts/promptStore';

/** Every editable AI prompt with its saved text and default. */
export async function GET() {
  try {
    return jsonOk({ prompts: await listPrompts() });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to load prompts', 500);
  }
}
