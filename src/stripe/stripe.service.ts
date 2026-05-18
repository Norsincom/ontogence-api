import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';

function createStripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    new Logger('StripeService').warn('STRIPE_SECRET_KEY not set — Stripe features disabled');
    return null;
  }
  return new Stripe(key, { apiVersion: '2025-02-24.acacia' as any });
}

const stripe = createStripeClient();

export const PRODUCTS = {
  registration: {
    name: 'Registration',
    priceId: 'price_1TViA8FJhxAto4oEmDf5PmxS',
    amount: 25000,
    currency: 'cad',
    recurring: false,
  },
  protocol: {
    name: 'Initial Protocol',
    priceId: 'price_1TViBRFJhxAto4oEvYCaUk2o',
    amount: 65000,
    currency: 'cad',
    recurring: false,
  },
  protocolRevision: {
    name: 'Protocol Revision',
    priceId: 'price_1TViKKFJhxAto4oEaBAF0eqI',
    amount: 27500,
    currency: 'cad',
    recurring: false,
  },
  monitoring3Month: {
    name: '3-Month Monitoring',
    priceId: 'price_1TViKnFJhxAto4oE0BtqlA2n',
    amount: 150000,
    currency: 'cad',
    recurring: false,
  },
  monitoring6Month: {
    name: '6-Month Monitoring',
    priceId: 'price_1TViLaFJhxAto4oEbgjJ5kOy',
    amount: 280000,
    currency: 'cad',
    recurring: false,
  },
  vaultAccess: {
    name: 'Vault Access',
    priceId: 'price_1TViNcFJhxAto4oE481iBBtA',
    amount: 500,
    currency: 'cad',
    recurring: true,
  },
} as const;

export type ProductKey = keyof typeof PRODUCTS;

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  constructor(private prisma: PrismaService) {}

  /** Single-product checkout (legacy, kept for backwards compat) */
  async createCheckoutSession(
    userId: string,
    userEmail: string,
    userName: string,
    productKey: ProductKey,
    successUrl: string,
    cancelUrl: string,
  ) {
    return this.createCartCheckoutSession(userId, userEmail, userName, [productKey], successUrl, cancelUrl);
  }

  /** Multi-product cart checkout — accepts an array of product keys */
  async createCartCheckoutSession(
    userId: string,
    userEmail: string,
    userName: string,
    productKeys: ProductKey[],
    successUrl: string,
    cancelUrl: string,
  ) {
    if (!stripe) throw new Error('Stripe is not configured');
    if (!productKeys.length) throw new Error('At least one product is required');

    const hasVault = productKeys.includes('vaultAccess');
    const oneTimeKeys = productKeys.filter(k => !PRODUCTS[k].recurring) as ProductKey[];
    const recurringKeys = productKeys.filter(k => PRODUCTS[k].recurring) as ProductKey[];

    // Stripe does not allow mixing payment + subscription modes in one session.
    // Strategy: if vault (recurring) is combined with one-time items, create two sessions.
    // Return both URLs so the frontend can chain them (vault after one-time).
    let vaultSessionUrl: string | null = null;

    if (hasVault && oneTimeKeys.length > 0) {
      // Mixed cart: vault subscription must be a separate session
      const vaultSess = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer_email: userEmail,
        allow_promotion_codes: true,
        line_items: [{ price: PRODUCTS.vaultAccess.priceId, quantity: 1 }],
        client_reference_id: userId,
        metadata: {
          user_id: userId,
          customer_email: userEmail,
          customer_name: userName,
          products: 'vaultAccess',
          has_vault: 'true',  // explicit — this session IS the vault
        },
        success_url: successUrl,
        cancel_url: cancelUrl,
      });
      vaultSessionUrl = vaultSess.url;
    }

    // Determine mode for the primary session
    // - subscription-only: vault alone (no one-time items)
    // - payment: one-time items only (vault handled separately above)
    const isSubscriptionOnly = recurringKeys.length > 0 && oneTimeKeys.length === 0;
    const mode: Stripe.Checkout.SessionCreateParams.Mode = isSubscriptionOnly ? 'subscription' : 'payment';

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = isSubscriptionOnly
      ? recurringKeys.map(k => ({ price: PRODUCTS[k].priceId, quantity: 1 }))
      : oneTimeKeys.map(k => ({
          price_data: {
            currency: PRODUCTS[k].currency,
            product_data: { name: PRODUCTS[k].name },
            unit_amount: PRODUCTS[k].amount,
          },
          quantity: 1,
        }));

    // CRITICAL: has_vault must be 'true' whenever this session will create a
    // Vault subscription. Two cases:
    //   1. Subscription-only session (vault purchased alone)
    //   2. One-time-only session that also included vault (vault split above, but
    //      the one-time session should NOT claim vault — vault is in vaultSessionUrl)
    // Therefore: has_vault='true' only for subscription-only sessions.
    const thisSessionHasVault = isSubscriptionOnly && recurringKeys.includes('vaultAccess');

    const session = await stripe.checkout.sessions.create({
      mode,
      customer_email: userEmail,
      allow_promotion_codes: true,
      line_items: lineItems,
      client_reference_id: userId,
      metadata: {
        user_id: userId,
        customer_email: userEmail,
        customer_name: userName,
        products: productKeys.join(','),
        has_vault: thisSessionHasVault ? 'true' : 'false',
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    return { url: session.url, sessionId: session.id, vaultSessionUrl };
  }

  async handleCheckoutComplete(session: Stripe.Checkout.Session) {
    const userId = session.client_reference_id || session.metadata?.user_id;
    if (!userId) {
      this.logger.warn('[Stripe] checkout.session.completed: no userId in client_reference_id or metadata');
      return;
    }

    this.logger.log(`[Stripe] checkout.session.completed: userId=${userId} mode=${session.mode} has_vault=${session.metadata?.has_vault}`);

    const amountCents = session.amount_total || 0;
    const stripePaymentIntentId = typeof session.payment_intent === 'string'
      ? session.payment_intent
      : (session.payment_intent as any)?.id || null;

    const products = session.metadata?.products || session.metadata?.product || 'payment';
    // has_vault is true if:
    //   (a) explicitly set in metadata, OR
    //   (b) this is a subscription-mode session (Stripe subscription sessions always create vault access)
    const hasVault = session.metadata?.has_vault === 'true' || session.mode === 'subscription';

    // Upsert invoice — stripeInvoiceId is unique, so duplicate webhooks are safe
    await this.prisma.invoice.upsert({
      where: { stripeInvoiceId: session.id },
      update: { status: 'paid', paidAt: new Date() },
      create: {
        id: uuidv4(),
        userId,
        stripeInvoiceId: session.id,
        stripePaymentIntentId,
        amountCents,
        currency: session.currency || 'cad',
        status: 'paid',
        description: products,
        paidAt: new Date(),
      },
    });

    // If vault was purchased, create/activate subscription record
    if (hasVault) {
      const stripeSubscriptionId = typeof session.subscription === 'string'
        ? session.subscription
        : (session.subscription as any)?.id || `vault-${userId}-${Date.now()}`;

      this.logger.log(`[Stripe] Activating vault for userId=${userId} stripeSubId=${stripeSubscriptionId}`);

      // Upsert: if a subscription already exists for this Stripe sub ID, update it;
      // otherwise create a new one. This handles duplicate webhook deliveries safely.
      const existingBySub = stripeSubscriptionId
        ? await this.prisma.subscription.findUnique({ where: { stripeSubscriptionId } }).catch(() => null)
        : null;

      if (existingBySub) {
        await this.prisma.subscription.update({
          where: { stripeSubscriptionId },
          data: { status: 'active', currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
        });
      } else {
        // Check for any existing active subscription for this user (dedup)
        const existingActive = await this.prisma.subscription.findFirst({ where: { userId, status: 'active' } });
        if (!existingActive) {
          await this.prisma.subscription.create({
            data: {
              id: uuidv4(),
              userId,
              stripeSubscriptionId,
              stripePriceId: PRODUCTS.vaultAccess.priceId,
              status: 'active',
              currentPeriodStart: new Date(),
              currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            },
          });
        } else {
          this.logger.log(`[Stripe] User ${userId} already has active subscription — skipping duplicate creation`);
        }
      }
    }

    await this.prisma.auditLog.create({
      data: {
        id: uuidv4(),
        userId,
        action: 'payment_succeeded',
        resourceType: 'invoice',
        metadata: { amount: amountCents, products },
      },
    });

    await this.prisma.timelineEvent.create({
      data: {
        id: uuidv4(),
        userId,
        eventType: 'payment',
        title: `Payment Received`,
        description: `Payment of $${(amountCents / 100).toFixed(2)} CAD processed successfully for: ${products}.`,
        occurredAt: new Date(),
      },
    });
  }

  async getSubscriptionStatus(userId: string, userRole?: string) {
    // Super admins always have full vault access without a subscription
    if (userRole === 'super_admin') {
      return { hasVaultAccess: true, subscription: null };
    }
    const sub = await this.prisma.subscription.findFirst({
      where: { userId, status: 'active' },
      orderBy: { createdAt: 'desc' },
    });
    return { hasVaultAccess: !!sub, subscription: sub };
  }

  async getInvoices(userId: string) {
    return this.prisma.invoice.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Handle customer.subscription.updated / customer.subscription.deleted events */
  async handleSubscriptionUpdate(subscription: Stripe.Subscription) {
    const stripeSubscriptionId = subscription.id;
    const stripeStatus = subscription.status; // 'active' | 'canceled' | 'past_due' | 'unpaid' | etc.

    this.logger.log(`[Stripe] subscription event: id=${stripeSubscriptionId} status=${stripeStatus}`);

    const existing = await this.prisma.subscription.findUnique({ where: { stripeSubscriptionId } });
    if (!existing) {
      this.logger.warn(`[Stripe] No local subscription found for stripeSubscriptionId=${stripeSubscriptionId}`);
      return;
    }

    const newStatus = stripeStatus === 'active' ? 'active' : 'canceled';
    await this.prisma.subscription.update({
      where: { stripeSubscriptionId },
      data: {
        status: newStatus as any,
        currentPeriodEnd: subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000)
          : undefined,
        cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
      },
    });

    this.logger.log(`[Stripe] Updated local subscription ${existing.id} → status=${newStatus}`);
  }

  constructEvent(payload: Buffer, signature: string) {
    if (!stripe) throw new Error('Stripe is not configured');
    return stripe.webhooks.constructEvent(payload, signature, process.env.STRIPE_WEBHOOK_SECRET || '');
  }
}
