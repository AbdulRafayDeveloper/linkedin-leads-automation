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
      // Personal email pool: adds to discoveredEmails + verifies + may update emailValidationStatus
      addManualEmail?: string;
      discoveredEmails?: string[];
      // Force re-verify a single email by address (updates verifiedEmails; only updates
      // emailValidationStatus if the email matches doc.email — the personal primary)
      forceVerifyEmail?: string;
      // SMTP-verify company emails without touching discoveredEmails or emailValidationStatus
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
    if (body.currentCompanies !== undefined) {
      doc.currentCompanies = body.currentCompanies;
    }

    // ── Force re-verify a single email via SMTP ─────────────────────────────
    // Updates verifiedEmails[]. Only updates emailValidationStatus if this is the
    // personal primary email (doc.email). Does NOT touch discoveredEmails.
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

      // Only update personal emailValidationStatus if this IS the personal primary email
      if (doc.email === emailClean) {
        doc.emailValidationStatus = status;
      }
    }

    // ── Verify company emails (SMTP-only) ───────────────────────────────────
    // Does NOT push to discoveredEmails. Does NOT update emailValidationStatus.
    // Only adds/updates the verifiedEmails array for SMTP badge display.
    if (body.verifyCompanyEmails && body.verifyCompanyEmails.length > 0) {
      await Promise.all(
        body.verifyCompanyEmails.map(async (emailRaw) => {
          const emailClean = emailRaw.trim().toLowerCase();
          if (!emailClean.includes('@')) return;

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
        })
      );
    }

    // ── Replace discoveredEmails (personal pool) directly ───────────────────
    // Also verifies any newly added personal emails via SMTP.
    if (body.discoveredEmails !== undefined) {
      doc.discoveredEmails = body.discoveredEmails;
      if (doc.discoveredEmails.length > 0 && !doc.email) {
        doc.email = body.discoveredEmails[0];
      }

      // Verify any not-yet-verified emails in the personal pool
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

      // Update personal emailValidationStatus to match the primary personal email
      if (doc.email) {
        const primaryStatus = doc.verifiedEmails.find((v) => v.email === doc.email)?.status;
        if (primaryStatus) doc.emailValidationStatus = primaryStatus;
      }
    }

    // ── Add personal emails (comma-separated) ──────────────────────────────
    // Pushes to discoveredEmails (personal pool) + SMTP verifies.
    // Only updates emailValidationStatus when this email is the personal primary.
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

        // Only update personal emailValidationStatus for the personal primary email
        if (doc.email === emailClean) {
          doc.emailValidationStatus = status;
        }
      }
    }

    doc.markModified('currentCompanies');
    doc.markModified('verifiedEmails');
    const result = await doc.save();
    return jsonOk({ result });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Failed to update lead ingestion record',
      500
    );
  }
}
