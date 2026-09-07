import { type NextRequest } from 'next/server';
import { connectToMongoDB } from '@/lib/db/connection';
import { Client } from '@/lib/db/models/Client';
import { jsonError, jsonOk } from '@/lib/api/response';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { name?: string };
    if (!body?.name?.trim()) {
      return jsonError('Missing required "name" field', 422);
    }

    await connectToMongoDB();
    const existing = await Client.findOne({ name: body.name.trim() });
    if (existing) {
      return jsonOk({ client: existing });
    }

    const client = await Client.create({ name: body.name.trim() });
    return jsonOk({ client }, 201);
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Failed to create client',
      500
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    const limit = Math.max(1, Number(searchParams.get('limit')) || 15);
    const search = searchParams.get('search')?.trim();

    await connectToMongoDB();

    const query: Record<string, unknown> = {};

    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.name = regex;
    }

    const skip = (page - 1) * limit;

    const [rawClients, total] = await Promise.all([
      Client.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Client.countDocuments(query),
    ]);

    const clients = rawClients.map((c) => ({
      ...c,
      _id: c._id.toString(),
    }));

    return jsonOk({
      clients,
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      hasMore: skip + rawClients.length < total,
    });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Failed to fetch clients',
      500
    );
  }
}
