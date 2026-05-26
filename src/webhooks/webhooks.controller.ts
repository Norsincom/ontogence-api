import { Controller, Post, Req, Res, HttpCode } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { Request, Response } from 'express';
import { Webhook } from 'svix';
import { v4 as uuidv4 } from 'uuid';
import { generateOntId } from '../common/utils/ontid.util';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private prisma: PrismaService) {}

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

    if (type === 'user.created') {
      const email = data.email_addresses?.[0]?.email_address || '';
      const name = [data.first_name, data.last_name].filter(Boolean).join(' ') || null;

      // ── UNIFIED ACCOUNT LINKAGE — Duplicate-account prevention ───────────────
      // Rule: ONE person = ONE Ontogence identity.
      //
      // If a user with this email already exists (created via a different Clerk
      // identity, pre-created by a Stripe webhook stub, or from a previous
      // sign-up attempt), link the new Clerk ID to the existing record instead
      // of creating a second row.
      //
      // This applies to:
      //   - Initial sign-ups after a prior Stripe purchase (stub user exists)
      //   - OAuth sign-ins with a different provider on the same email
      //   - Re-registrations after account deletion/recovery
      //   - Any future authentication method added to the platform
      //
      // The existing user's ontId, stripeCustomerId, protocols, vault, purchases,
      // audit history, and all linked data are preserved intact.
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

      // Generate ONTID for new user — server-side, sequential, immutable
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

      await this.prisma.auditLog.create({
        data: {
          id: uuidv4(),
          userId: data.id,
          action: 'user_registered',
          metadata: { email, ontId },
        },
      });
    }

    if (type === 'user.updated') {
      const email = data.email_addresses?.[0]?.email_address || '';
      const name = [data.first_name, data.last_name].filter(Boolean).join(' ') || null;

      await this.prisma.user.updateMany({
        where: { clerkId: data.id },
        // NOTE: ontId and stripeCustomerId are intentionally excluded —
        // they must never change after assignment (immutable identity fields)
        data: { email, name, avatarUrl: data.image_url || null, updatedAt: new Date() },
      });
    }

    if (type === 'user.deleted') {
      await this.prisma.user.deleteMany({ where: { clerkId: data.id } });
    }

    return res.json({ received: true });
  }
}
