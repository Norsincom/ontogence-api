import { Controller, Post, Req, Res, HttpCode, Logger } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { Request, Response } from 'express';
import { Webhook } from 'svix';
import { v4 as uuidv4 } from 'uuid';
import { generateOntId } from '../common/utils/ontid.util';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private prisma: PrismaService,
    private stripeService: StripeService,
  ) {}

  @Post('clerk')
  @Public()
  @HttpCode(200)
  async handleClerkWebhook(@Req() req: Request, @Res() res: Response) {
    const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    const svixId = req.headers['svix-id'] as string;
    const svixTimestamp = req.headers['svix-timestamp'] as string;
    const svixSignature = req.headers['svix-signature'] as string;

    if (!svixId || !svixTimestamp || !svixSignature) {
      return res.status(400).json({ error: 'Missing svix headers' });
    }

    let event: any;
    try {
      const wh = new Webhook(webhookSecret);
      event = wh.verify(JSON.stringify(req.body), {
        'svix-id': svixId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': svixSignature,
      });
    } catch {
      return res.status(400).json({ error: 'Webhook verification failed' });
    }

    const { type, data } = event;

    // ─────────────────────────────────────────────────────────────────────────
    // user.created — ONTOGENCE UNIFIED ACCOUNT LINKAGE
    // ─────────────────────────────────────────────────────────────────────────
    // RULE: ONE person = ONE Ontogence identity across ALL platforms.
    //
    // On every new Clerk sign-up we:
    //   1. Check if a user with this email already exists (e.g. created by a
    //      prior Stripe purchase stub) — if so, link the new Clerk ID to the
    //      existing record and preserve all data.
    //   2. Create the ONTOGENCE DB user record with a unique ONT-ID.
    //   3. Immediately create a Stripe Customer and persist stripeCustomerId.
    //      This guarantees that ALL future purchases — regardless of path —
    //      attach to the same named Stripe customer and never create a guest
    //      checkout or duplicate customer record.
    // ─────────────────────────────────────────────────────────────────────────
    if (type === 'user.created') {
      const email = data.email_addresses?.[0]?.email_address || '';
      const name = [data.first_name, data.last_name].filter(Boolean).join(' ') || null;

      // ── Step 1: Duplicate-account prevention ─────────────────────────────
      // If a user with this email already exists (stub from Stripe, prior
      // sign-up, or OAuth with different provider), link the Clerk ID to the
      // existing record instead of creating a second row.
      const existingByEmail = await this.prisma.user.findUnique({ where: { email } });

      if (existingByEmail && existingByEmail.clerkId !== data.id) {
        await this.prisma.user.update({
          where: { id: existingByEmail.id },
          data: {
            clerkId: data.id,
            name: name || existingByEmail.name,
            avatarUrl: data.image_url || existingByEmail.avatarUrl,
            updatedAt: new Date(),
          },
        });

        // Ensure this existing user also has a Stripe customer (may be missing
        // if they were created as a stub before the Stripe-on-signup logic)
        if (!existingByEmail.stripeCustomerId && email) {
          try {
            await this.stripeService.ensureStripeCustomer(
              existingByEmail.id,
              email,
              name || existingByEmail.name || '',
            );
            this.logger.log(`[Webhook] Created/linked Stripe customer for merged user ${existingByEmail.id}`);
          } catch (err: any) {
            this.logger.warn(`[Webhook] Stripe customer creation failed for merged user: ${err.message}`);
          }
        }

        await this.prisma.auditLog.create({
          data: {
            id: uuidv4(),
            userId: existingByEmail.id,
            action: 'user_registered',
            metadata: {
              email,
              note: 'Linked new Clerk identity to existing account (unified account linkage)',
              newClerkId: data.id,
              previousClerkId: existingByEmail.clerkId,
            },
          },
        });
        return res.json({ received: true, merged: true });
      }

      // ── Step 2: Create new ONTOGENCE user record ──────────────────────────
      const ontId = await generateOntId(this.prisma);

      await this.prisma.user.upsert({
        where: { clerkId: data.id },
        update: { email, name, avatarUrl: data.image_url || null, updatedAt: new Date() },
        create: {
          id: data.id,
          clerkId: data.id,
          email,
          name,
          avatarUrl: data.image_url || null,
          ontId,
          updatedAt: new Date(),
        },
      });

      // ── Step 3: Immediately create Stripe customer ────────────────────────
      // This is the critical step that prevents all future guest checkouts and
      // duplicate customers. Every user gets a named Stripe customer at sign-up,
      // before any purchase is made. Future checkouts hit the fast path (Step 1
      // of findOrCreateStripeCustomer) and never create a duplicate.
      if (email) {
        try {
          await this.stripeService.ensureStripeCustomer(data.id, email, name || '');
          this.logger.log(`[Webhook] Stripe customer created/linked for new user ${data.id} (${email})`);
        } catch (err: any) {
          // Non-fatal: log and continue. The checkout flow has its own fallback.
          this.logger.warn(`[Webhook] Stripe customer creation failed for new user ${data.id}: ${err.message}`);
        }
      }

      await this.prisma.auditLog.create({
        data: {
          id: uuidv4(),
          userId: data.id,
          action: 'user_registered',
          metadata: { email, ontId },
        },
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // user.updated — sync name/email changes, never touch identity fields
    // ─────────────────────────────────────────────────────────────────────────
    if (type === 'user.updated') {
      const email = data.email_addresses?.[0]?.email_address || '';
      const name = [data.first_name, data.last_name].filter(Boolean).join(' ') || null;

      await this.prisma.user.updateMany({
        where: { clerkId: data.id },
        // ontId and stripeCustomerId are intentionally excluded —
        // they are immutable identity fields that must never change after assignment
        data: { email, name, avatarUrl: data.image_url || null, updatedAt: new Date() },
      });

      // Also update the name on the Stripe customer record to keep them in sync
      if (name) {
        try {
          const user = await this.prisma.user.findFirst({ where: { clerkId: data.id } });
          if (user?.stripeCustomerId) {
            const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
            await stripe.customers.update(user.stripeCustomerId, { name, email });
            this.logger.log(`[Webhook] Synced Stripe customer name/email for ${user.id}`);
          }
        } catch (err: any) {
          this.logger.warn(`[Webhook] Stripe customer sync failed on user.updated: ${err.message}`);
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // user.deleted — remove from ONTOGENCE DB
    // ─────────────────────────────────────────────────────────────────────────
    if (type === 'user.deleted') {
      await this.prisma.user.deleteMany({ where: { clerkId: data.id } });
    }

    return res.json({ received: true });
  }
}
