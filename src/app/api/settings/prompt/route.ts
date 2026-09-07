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
        senderName: 'Abdul Rafay',
        senderTitle: 'Senior Full Stack AI Developer',
        senderPositioning: 'builds production web and AI applications|has shipped 70+ production-ready SaaS products and MVPs|works hands-on with real-world production systems',
        senderPortfolioUrl: 'https://rafaytech.vercel.app',
        senderLinkedinUrl: 'https://www.linkedin.com/in/abdulrafay-ai-mern',
        senderPhone: '+92 306 0815246',
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
    const body = (await request.json()) as {
      promptText?: string;
      senderName?: string;
      senderTitle?: string;
      senderPositioning?: string;
      senderPortfolioUrl?: string;
      senderLinkedinUrl?: string;
      senderPhone?: string;
    };

    await connectToMongoDB();
    let setting = await PromptSetting.findOne({ key: 'global_outreach_prompt' });
    if (!setting) {
      setting = new PromptSetting({ key: 'global_outreach_prompt' });
    }

    if (body.promptText !== undefined) setting.promptText = body.promptText.trim();
    if (body.senderName !== undefined) setting.senderName = body.senderName.trim();
    if (body.senderTitle !== undefined) setting.senderTitle = body.senderTitle.trim();
    if (body.senderPositioning !== undefined) setting.senderPositioning = body.senderPositioning.trim();
    if (body.senderPortfolioUrl !== undefined) setting.senderPortfolioUrl = body.senderPortfolioUrl.trim();
    if (body.senderLinkedinUrl !== undefined) setting.senderLinkedinUrl = body.senderLinkedinUrl.trim();
    if (body.senderPhone !== undefined) setting.senderPhone = body.senderPhone.trim();

    const saved = await setting.save();
    return jsonOk({ setting: saved.toObject() });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Failed to update global prompt settings',
      500
    );
  }
}
