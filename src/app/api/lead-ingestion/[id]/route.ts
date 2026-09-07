import type { NextRequest } from 'next/server';
import { connectToMongoDB } from '@/lib/db/connection';
import { LeadIngestion, type CurrentCompanyItem, type VerifiedEmailItem } from '@/lib/db/models/LeadIngestion';
import { verifyEmailSmtp } from '@/services/lead-ingestion/smtpVerifier';
import { jsonError, jsonOk } from '@/lib/api/response';
import mongoose from 'mongoose';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return jsonError('Invalid lead ingestion ID', 400);
    }

    await connectToMongoDB();
    const doc = await LeadIngestion.findById(id);
    if (!doc) {
      return jsonError('Lead ingestion record not found', 404);
    }

    return jsonOk({ result: doc.toObject() });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Failed to fetch lead ingestion record',
      500
    );
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return jsonError('Invalid lead ingestion ID', 400);
    }

    const body = (await request.json()) as {
      websiteUrl?: string;
      emailSubject?: string;
      emailBody?: string;
      approved?: boolean;
      currentCompanies?: CurrentCompanyItem[];
      addManualEmail?: string;
      discoveredEmails?: string[];
    };

    await connectToMongoDB();
    const doc = await LeadIngestion.findById(id);
    if (!doc) {
      return jsonError('Lead ingestion record not found', 404);
    }

    if (body.websiteUrl !== undefined) {
      doc.websiteUrl = body.websiteUrl.trim();
    }
    if (body.emailSubject !== undefined) {
      doc.emailSubject = body.emailSubject;
    }
    if (body.emailBody !== undefined) {
      doc.emailBody = body.emailBody;
    }
    if (body.approved !== undefined) {
      doc.approved = body.approved;
    }
    if (body.currentCompanies !== undefined) {
      doc.currentCompanies = body.currentCompanies;
    }

    // Direct replacement of discoveredEmails (for editing/removing personal/discovered emails)
    if (body.discoveredEmails !== undefined) {
      doc.discoveredEmails = body.discoveredEmails;
      doc.email = body.discoveredEmails[0] || null;

      // Re-verify any new emails
      for (const emailClean of doc.discoveredEmails) {
        const existingIndex = doc.verifiedEmails.findIndex((v) => v.email === emailClean);
        if (existingIndex === -1) {
          let status: VerifiedEmailItem['status'] = 'unknown';
          try {
            const verifyRes = await verifyEmailSmtp(emailClean);
            status = verifyRes.status;
          } catch {
            status = 'unknown';
          }
          doc.verifiedEmails.push({ email: emailClean, status });
        }
      }
    }

    // Add manual emails (comma-separated or single) and run instant SMTP verification
    if (body.addManualEmail && body.addManualEmail.trim()) {
      const emailList = body.addManualEmail
        .split(/[,;\s]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.includes('@'));

      for (const emailClean of emailList) {
        if (!doc.discoveredEmails.includes(emailClean)) {
          doc.discoveredEmails.push(emailClean);
        }
        if (!doc.email) {
          doc.email = emailClean;
        }

        let status: VerifiedEmailItem['status'] = 'unknown';
        try {
          const verifyRes = await verifyEmailSmtp(emailClean);
          status = verifyRes.status;
        } catch {
          status = 'unknown';
        }

        const existingIndex = doc.verifiedEmails.findIndex((v) => v.email === emailClean);
        if (existingIndex !== -1) {
          doc.verifiedEmails[existingIndex].status = status;
        } else {
          doc.verifiedEmails.push({ email: emailClean, status });
        }

        doc.emailValidationStatus = status;
      }
    }

    const result = await doc.save();
    return jsonOk({ result });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Failed to update lead ingestion record',
      500
    );
  }
}
