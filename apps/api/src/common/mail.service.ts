import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

/**
 * Outgoing email, for the password-reset link. Configured entirely by
 * environment, so a box without a mailbox simply reports "not configured" and
 * the screens say so instead of promising an email that never comes.
 *
 *   SMTP_HOST      the mail server (smtp.gmail.com for a Google mailbox)
 *   SMTP_PORT      587 (STARTTLS, the default) or 465 (TLS from the start)
 *   SMTP_USER      the mailbox login
 *   SMTP_PASS      its password — for Gmail, an App Password, not the account one
 *   MAIL_FROM      the sender shown to the reader, e.g. "Mix Nova <mixnova360@gmail.com>"
 */
@Injectable()
export class MailService {
  private readonly log = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  isConfigured(): boolean {
    return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  }

  /** The address the reader sees, so the screens can name the mailbox. */
  from(): string {
    return process.env.MAIL_FROM || process.env.SMTP_USER || '';
  }

  private transport(): Transporter {
    if (!this.transporter) {
      const port = Number(process.env.SMTP_PORT ?? 587);
      this.transporter = createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: process.env.SMTP_SECURE === 'true' || port === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        connectionTimeout: Number(process.env.SMTP_TIMEOUT_MS ?? 10_000),
      });
    }
    return this.transporter;
  }

  /** Send one message. Returns false, and logs, when the mailbox refuses. */
  async send(msg: { to: string; subject: string; text: string; html?: string }): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      await this.transport().sendMail({ from: this.from(), ...msg });
      return true;
    } catch (err) {
      this.log.error(`Could not send "${msg.subject}" to ${msg.to}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
}
