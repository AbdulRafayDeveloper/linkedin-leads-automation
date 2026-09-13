import nodemailer from 'nodemailer';

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export async function sendOutboundEmail({
  to,
  subject,
  htmlBody,
}: {
  to: string;
  subject: string;
  htmlBody: string;
}): Promise<SendEmailResult> {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true'; // false for 587, true for 465
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || `"${process.env.SENDER_NAME || 'Abdul Rafay'}" <${user}>`;

  if (!user || !pass) {
    return {
      success: false,
      error: 'SMTP credentials (SMTP_USER/SMTP_PASS) are not configured in environment variables.',
    };
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {
        user,
        pass,
      },
    });

    const plainText = (htmlBody || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();

    const senderName = process.env.SMTP_FROM_NAME || process.env.SENDER_NAME || 'Abdul Rafay';
    const formattedFrom = `"${senderName}" <${user}>`;
    const randomHex = Math.random().toString(36).substring(2, 10);
    const customMessageId = `<${Date.now()}.${randomHex}@gmail.com>`;

    const info = await transporter.sendMail({
      from: formattedFrom,
      to,
      replyTo: user,
      subject,
      text: plainText,
      html: htmlBody,
      messageId: customMessageId,
      headers: {
        'X-Mailer': 'GmailOutreach/1.0',
        'X-Priority': '3',
        'X-MSMail-Priority': 'Normal',
        'Importance': 'Normal',
      },
    });

    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown SMTP delivery error',
    };
  }
}
