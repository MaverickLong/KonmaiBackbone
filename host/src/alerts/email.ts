import { setTimeout as sleep } from 'node:timers/promises';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Config } from '../config.js';
import type { Logger } from '../logger.js';

const retryDelaysMilliseconds = [1_000, 5_000, 30_000];

export class Alerts {
  private readonly transport: Transporter | null;

  constructor(
    private readonly config: Config['email'],
    private readonly logger: Logger,
  ) {
    this.transport = config === null ? null : nodemailer.createTransport(config.smtpUrl);
  }

  // Resolves to whether the message was actually delivered; failures are logged, never thrown,
  // because an alert must not take down the loop that raised it.
  async send(subject: string, text: string): Promise<boolean> {
    if (this.transport === null || this.config === null) {
      this.logger.warn({ subject }, 'e-mail not configured, alert logged only');
      return false;
    }
    for (const [attempt, delay] of retryDelaysMilliseconds.entries()) {
      try {
        await this.transport.sendMail({
          from: this.config.from,
          to: this.config.to,
          subject: `[konmai] ${subject}`,
          text,
        });
        return true;
      } catch (error) {
        this.logger.error({ error, subject, attempt }, 'sending alert e-mail failed');
        await sleep(delay);
      }
    }
    return false;
  }
}
