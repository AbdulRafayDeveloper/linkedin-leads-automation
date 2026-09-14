import { type NextRequest } from 'next/server';
import { connectToMongoDB } from '@/lib/db/connection';
import { PromptSetting } from '@/lib/db/models/PromptSetting';
import { jsonError, jsonOk } from '@/lib/api/response';

export async function GET() {
  try {
    await connectToMongoDB();
    let setting = await PromptSetting.findOne({ key: 'global_outreach_prompt' });
    if (!setting) {
      setting = await PromptSetting.create({
        key: 'global_outreach_prompt',
        promptText: 'Focus on highlighting custom software development capabilities, speed of delivery, and professional partnership.',
      });
    }

    return jsonOk({ setting: setting.toObject() });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Failed to fetch global prompt settings',
      500
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as { promptText?: string };

    await connectToMongoDB();
    let setting = await PromptSetting.findOne({ key: 'global_outreach_prompt' });
    if (!setting) {
      setting = new PromptSetting({ key: 'global_outreach_prompt' });
    }

    if (body.promptText !== undefined) setting.promptText = body.promptText.trim();

    const saved = await setting.save();
    return jsonOk({ setting: saved.toObject() });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Failed to update global prompt settings',
      500
    );
  }
}
