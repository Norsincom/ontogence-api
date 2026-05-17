import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private resend: Resend;

  constructor() {
    this.resend = new Resend(process.env.RESEND_API_KEY);
  }

  async sendWelcome(to: string, name: string) {
    try {
      await this.resend.emails.send({
        from: 'Ontogence <noreply@ontogence.com>',
        to,
        subject: 'Welcome to Ontogence — Your Mechanism Intelligence Journey Begins',
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; background: #0f1117; color: #e8eaf0; padding: 40px 32px; border-radius: 16px;">
            <div style="margin-bottom: 32px;">
              <span style="font-size: 24px; font-weight: 700; color: #5bcea0; letter-spacing: -0.5px;">Ontogence</span>
            </div>
            <h1 style="font-size: 28px; font-weight: 700; color: #f0f2f8; margin: 0 0 16px;">Welcome, ${name}.</h1>
            <p style="color: #8b9ab5; line-height: 1.7; margin: 0 0 24px;">
              Your account has been created. You now have access to the Ontogence platform — a precision health intelligence system built around your biology.
            </p>
            <p style="color: #8b9ab5; line-height: 1.7; margin: 0 0 32px;">
              Your consultant will reach out shortly to begin your intake assessment. In the meantime, you can explore your dashboard and upload any existing health records to your Medical Vault.
            </p>
            <a href="https://ontogence.com/dashboard" style="display: inline-block; background: #5bcea0; color: #0f1117; font-weight: 600; padding: 12px 24px; border-radius: 10px; text-decoration: none; font-size: 15px;">
              Access Dashboard →
            </a>
            <p style="color: #4a5568; font-size: 12px; margin-top: 40px;">
              Ontogence · admin@ontogence.com · ontogence.com
            </p>
          </div>
        `,
      });
    } catch (err) {
      this.logger.error('Failed to send welcome email', err);
    }
  }

  async sendProtocolDelivered(to: string, name: string, protocolTitle: string) {
    try {
      await this.resend.emails.send({
        from: 'Ontogence <noreply@ontogence.com>',
        to,
        subject: `New Protocol Delivered: ${protocolTitle}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; background: #0f1117; color: #e8eaf0; padding: 40px 32px; border-radius: 16px;">
            <div style="margin-bottom: 32px;">
              <span style="font-size: 24px; font-weight: 700; color: #5bcea0;">Ontogence</span>
            </div>
            <h1 style="font-size: 24px; font-weight: 700; color: #f0f2f8; margin: 0 0 16px;">New Protocol Available</h1>
            <p style="color: #8b9ab5; line-height: 1.7; margin: 0 0 16px;">Hi ${name},</p>
            <p style="color: #8b9ab5; line-height: 1.7; margin: 0 0 24px;">
              Your consultant has delivered a new protocol: <strong style="color: #f0f2f8;">${protocolTitle}</strong>. 
              Log in to your dashboard to review it.
            </p>
            <a href="https://ontogence.com/protocols" style="display: inline-block; background: #5bcea0; color: #0f1117; font-weight: 600; padding: 12px 24px; border-radius: 10px; text-decoration: none; font-size: 15px;">
              View Protocol →
            </a>
          </div>
        `,
      });
    } catch (err) {
      this.logger.error('Failed to send protocol email', err);
    }
  }

  async sendNewMessage(to: string, name: string, senderName: string) {
    try {
      await this.resend.emails.send({
        from: 'Ontogence <noreply@ontogence.com>',
        to,
        subject: `New message from ${senderName}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; background: #0f1117; color: #e8eaf0; padding: 40px 32px; border-radius: 16px;">
            <div style="margin-bottom: 32px;">
              <span style="font-size: 24px; font-weight: 700; color: #5bcea0;">Ontogence</span>
            </div>
            <h1 style="font-size: 22px; font-weight: 700; color: #f0f2f8; margin: 0 0 16px;">You have a new message</h1>
            <p style="color: #8b9ab5; line-height: 1.7; margin: 0 0 24px;">
              Hi ${name}, <strong style="color: #f0f2f8;">${senderName}</strong> has sent you a message on Ontogence.
            </p>
            <a href="https://ontogence.com/messaging" style="display: inline-block; background: #5bcea0; color: #0f1117; font-weight: 600; padding: 12px 24px; border-radius: 10px; text-decoration: none; font-size: 15px;">
              Read Message →
            </a>
          </div>
        `,
      });
    } catch (err) {
      this.logger.error('Failed to send message notification email', err);
    }
  }

  async sendNewMessageToAdmin(to: string, adminName: string, clientName: string, _clientDisplayName: string, timestamp: string) {
    try {
      await this.resend.emails.send({
        from: 'Ontogence <noreply@ontogence.com>',
        to,
        subject: `New message from client: ${clientName}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; background: #0f1117; color: #e8eaf0; padding: 40px 32px; border-radius: 16px;">
            <div style="margin-bottom: 32px;"><span style="font-size: 24px; font-weight: 700; color: #5bcea0;">Ontogence</span></div>
            <h1 style="font-size: 22px; font-weight: 700; color: #f0f2f8; margin: 0 0 16px;">New Client Message</h1>
            <p style="color: #8b9ab5; line-height: 1.7; margin: 0 0 16px;">Hi ${adminName},</p>
            <p style="color: #8b9ab5; line-height: 1.7; margin: 0 0 8px;">
              <strong style="color: #f0f2f8;">${clientName}</strong> sent you a message at ${timestamp}.
            </p>
            <p style="color: #8b9ab5; line-height: 1.7; margin: 0 0 24px;">Log in to your admin console to view and respond.</p>
            <a href="https://ontogence.com/admin/messages" style="display: inline-block; background: #5bcea0; color: #0f1117; font-weight: 600; padding: 12px 24px; border-radius: 10px; text-decoration: none; font-size: 15px;">Open Admin Messages →</a>
            <p style="color: #4a5568; font-size: 12px; margin-top: 40px;">Ontogence · admin@ontogence.com · ontogence.com</p>
          </div>
        `,
      });
    } catch (err) {
      this.logger.error('Failed to send admin message notification email', err);
    }
  }

  async notifyAdmin(subject: string, body: string) {
    try {
      await this.resend.emails.send({
        from: 'Ontogence System <noreply@ontogence.com>',
        to: 'admin@ontogence.com',
        subject,
        html: `<div style="font-family: monospace; padding: 24px; background: #0f1117; color: #e8eaf0; border-radius: 8px;">${body}</div>`,
      });
    } catch (err) {
      this.logger.error('Failed to send admin notification', err);
    }
  }
}
