import { NextResponse } from 'next/server';

export function jsonOk<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, ...data }, { status });
}

/** `extra` carries machine-readable detail, e.g. the duplicate a 409 refers to. */
export function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, error: message, ...extra }, { status });
}
