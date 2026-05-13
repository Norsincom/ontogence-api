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
    amount: 250000,
    currency: 'cad',
    recurring: false,
  },
  monitoring12Month: {
    name: '12-Month Monitoring',
    priceId: 'price_1TViM6FJhxAto4oE2AmkUvWx',
    amount: 500000,
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
      // Create vault subscription session separately
      const vaultSess = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer_email: userEmail,
        allow_promotion_codes: true,
        line_items: [{ price: PRODUCTS.vaultAccess.priceId, quantity: 1 }],
        client_reference_id: userId,
        metadata: { user_id: userId, customer_email: userEmail, customer_name: userName, products: 'vaultAccess', has_vault: 'true' },
        success_url: successUrl,
        cancel_url: cancelUrl,
      });
      vaultSessionUrl = vaultSess.url;
    }

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
        has_vault: hasVault ? 'true' : 'false',
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    return { url: session.url, sessionId: session.id, vaultSessionUrl };
  }

  async handleCheckoutComplete(session: Stripe.Checkout.Session) {
    const userId = session.client_reference_id || session.metadata?.user_id;
    if (!userId) return;

    const amountCents = session.amount_total || 0;
    const stripePaymentIntentId = typeof session.payment_intent === 'string'
      ? session.payment_intent
      : (session.payment_intent as any)?.id || null;

    const products = session.metadata?.products || session.metadata?.product || 'payment';
    const hasVault = session.metadata?.has_vault === 'true' || session.mode === 'subscription';

    await this.prisma.invoice.create({
      data: {
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
        : (session.subscription as any)?.id || `manual-${userId}-${Date.now()}`;

      const existing = await this.prisma.subscription.findFirst({ where: { userId, status: 'active' } });
      if (!existing) {
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

  async getSubscriptionStatus(userId: string) {
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

  constructEvent(payload: Buffer, signature: string) {
    if (!stripe) throw new Error('Stripe is not configured');
    return stripe.webhooks.constructEvent(payload, signature, process.env.STRIPE_WEBHOOK_SECRET || '');
  }
}
