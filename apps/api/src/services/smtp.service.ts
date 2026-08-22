import nodemailer from 'nodemailer';
import type { SmtpSenderConfig } from '../config.js';

export type SmtpFailureKind = 'transient' | 'permanent' | 'ambiguous';

interface SmtpErrorDetails {
  code?: string;
  command?: string;
  responseCode?: number;
}

interface SmtpMessage {
  emailJobId: string;
  recipient: string;
  subject: string;
  html: string;
  text: string | null;
  attachments: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }>;
}

export function classifySmtpFailure(error: unknown): SmtpFailureKind {
  if (!error || typeof error !== 'object') return 'transient';

  const details = error as SmtpErrorDetails;
  if (
    details.command === 'DATA' &&
    ['ETIMEDOUT', 'ECONNRESET', 'ESOCKET'].includes(details.code ?? '')
  ) {
    return 'ambiguous';
  }
  if (
    details.responseCode !== undefined &&
    details.responseCode >= 400 &&
    details.responseCode < 500
  ) {
    return 'transient';
  }
  if (
    details.code === 'EAUTH' ||
    details.code === 'EENVELOPE' ||
    details.code === 'EMESSAGE' ||
    (details.responseCode !== undefined && details.responseCode >= 500)
  ) {
    return 'permanent';
  }
  return 'transient';
}

export function createSmtpTransport(sender: SmtpSenderConfig) {
  return nodemailer.createTransport({
    host: sender.host,
    port: sender.port,
    secure: sender.secure,
    auth: { user: sender.user, pass: sender.pass },
    requireTLS: !sender.secure && sender.requireTls,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
}

export async function sendSmtpEmail(
  sender: SmtpSenderConfig,
  message: SmtpMessage,
): Promise<{ messageId: string; previewUrl: string | null }> {
  const transport = createSmtpTransport(sender);

  try {
    const result = await transport.sendMail({
      from: { name: sender.name, address: sender.email },
      to: message.recipient,
      subject: message.subject,
      html: message.html,
      text: message.text ?? undefined,
      attachments: message.attachments,
      headers: { 'X-ReachInbox-Email-Id': message.emailJobId },
    });
    return {
      messageId: result.messageId,
      previewUrl: nodemailer.getTestMessageUrl(result) || null,
    };
  } finally {
    transport.close();
  }
}