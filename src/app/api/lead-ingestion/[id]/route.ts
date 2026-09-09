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
      portfolioUrl?: string;
      emailSubject?: string;
      emailBody?: string;
      approved?: boolean;
      currentCompanies?: CurrentCompanyItem[];
      addManualEmail?: string;
      discoveredEmails?: string[];
      forceVerifyEmail?: string;
      verifyCompanyEmails?: string[];
    };

    await connectToMongoDB();
    const doc = await LeadIngestion.findById(id);
    if (!doc) {
      return jsonError('Lead ingestion record not found', 404);
    }

    // ── Simple scalar field updates ─────────────────────────────────────────
    if (body.websiteUrl !== undefined) {
      doc.websiteUrl = body.websiteUrl.trim();
    }
    if (body.portfolioUrl !== undefined) {
      doc.portfolioUrl = body.portfolioUrl.trim() || null;
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

    // ── Company sub-boxes updates ───────────────────────────────────────────
    if (body.currentCompanies !== undefined) {
      doc.currentCompanies = body.currentCompanies.map((c, idx) => {
        const existing = doc.currentCompanies[idx];
        const validName = c.companyName && c.companyName !== 'Unspecified Company' && c.companyName !== 'Unknown Company' ? c.companyName : null;
        const validJob = c.jobTitle && c.jobTitle !== 'Professional' ? c.jobTitle : null;

        return {
          companyName: validName ?? existing?.companyName ?? 'Unspecified Company',
          jobTitle: validJob ?? existing?.jobTitle ?? 'Professional',
          workPeriod: c.workPeriod ?? existing?.workPeriod ?? null,
          websiteUrl: c.websiteUrl ?? existing?.websiteUrl ?? null,
          summary: c.summary ?? existing?.summary ?? '',
          companyEmails: c.companyEmails ?? existing?.companyEmails ?? [],
          emailSubject: c.emailSubject ?? existing?.emailSubject ?? null,
          emailBody: c.emailBody ?? existing?.emailBody ?? null,
          approved: c.approved ?? existing?.approved ?? false,
        };
      });
      doc.markModified('currentCompanies');
      if (doc.currentCompanies[0]?.companyName) {
        doc.companyName = doc.currentCompanies[0].companyName;
      }
    }

    // ── Explicit single email force SMTP verification ───────────────────────
    if (body.forceVerifyEmail && body.forceVerifyEmail.trim()) {
      const emailClean = body.forceVerifyEmail.trim().toLowerCase();
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

      if (doc.email === emailClean) {
        doc.emailValidationStatus = status;
      }
    }

    // ── Register company emails (non-blocking) ─────────────────────────────
    if (body.verifyCompanyEmails && body.verifyCompanyEmails.length > 0) {
      body.verifyCompanyEmails.forEach((emailRaw) => {
        const emailClean = emailRaw.trim().toLowerCase();
        if (!emailClean.includes('@')) return;
        const existingIndex = doc.verifiedEmails.findIndex((v) => v.email === emailClean);
        if (existingIndex === -1) {
          doc.verifiedEmails.push({ email: emailClean, status: 'pending' });
        }
      });
    }

    // ── Replace discoveredEmails (personal pool) directly ───────────────────
    if (body.discoveredEmails !== undefined) {
      doc.discoveredEmails = body.discoveredEmails;
      doc.email = doc.discoveredEmails.length > 0 ? doc.discoveredEmails[0] : null;

      for (const emailClean of doc.discoveredEmails) {
        const existingIndex = doc.verifiedEmails.findIndex((v) => v.email === emailClean);
        if (existingIndex === -1) {
          doc.verifiedEmails.push({ email: emailClean, status: 'pending' });
        }
      }

      if (doc.email) {
        const primaryStatus = doc.verifiedEmails.find((v) => v.email === doc.email)?.status;
        if (primaryStatus) doc.emailValidationStatus = primaryStatus;
      }
    }

    // ── Add personal emails (non-blocking fast save) ────────────────────────
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

        const existingIndex = doc.verifiedEmails.findIndex((v) => v.email === emailClean);
        if (existingIndex === -1) {
          doc.verifiedEmails.push({ email: emailClean, status: 'pending' });
        }

        if (doc.email === emailClean) {
          const primaryStatus = doc.verifiedEmails.find((v) => v.email === doc.email)?.status;
          if (primaryStatus) doc.emailValidationStatus = primaryStatus;
        }
      }
    }

    doc.markModified('currentCompanies');
    doc.markModified('verifiedEmails');
    doc.markModified('discoveredEmails');
    const result = await doc.save();
    return jsonOk({ result });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Failed to update lead ingestion record',
      500
    );
  }
}
