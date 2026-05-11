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
  },
  protocol: {
    name: 'Initial Protocol',
    priceId: 'price_1TViBRFJhxAto4oEvYCaUk2o',
    amount: 65000,
    currency: 'cad',
  },
  protocolRevision: {
    name: 'Protocol Revision',
    priceId: 'price_1TViKKFJhxAto4oEaBAF0eqI',
    amount: 27500,
    currency: 'cad',
  },
  monitoring3Month: {
    name: '3-Month Monitoring',
    priceId: 'price_1TViKnFJhxAto4oE0BtqlA2n',
    amount: 150000,
    currency: 'cad',
  },
  monitoring6Month: {
    name: '6-Month Monitoring',
    priceId: 'price_1TViLaFJhxAto4oEbgjJ5kOy',
    amount: 250000,
    currency: 'cad',
  },
  monitoring12Month: {
    name: '12-Month Monitoring',
    priceId: 'price_1TViM6FJhxAto4oE2AmkUvWx',
    amount: 500000,
    currency: 'cad',
  },
  vaultAccess: {
    name: 'Vault Access',
    priceId: 'price_1TViNcFJhxAto4oE481iBBtA',
    amount: 500,
    currency: 'cad',
    recurring: true,
  },
};

@Injectable()
export class StripeService {
  constructor(private prisma: PrismaService) {}

  async createCheckoutSession(
    userId: string,
    userEmail: string,
    userName: string,
    productKey: keyof typeof PRODUCTS,
    successUrl: string,
    cancelUrl: string,
  ) {
    const product = PRODUCTS[productKey];

    if (!stripe) throw new Error('Stripe is not configured');
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: userEmail,
      allow_promotion_codes: true,
      line_items: [
        {
          price_data: {
            currency: product.currency,
            product_data: { name: product.name },
            unit_amount: product.amount,
          },
          quantity: 1,
        },
      ],
      client_reference_id: userId,
      metadata: {
        user_id: userId,
        customer_email: userEmail,
        customer_name: userName,
        product: productKey,
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    return { url: session.url, sessionId: session.id };
  }

  async handleCheckoutComplete(session: Stripe.Checkout.Session) {
    const userId = session.client_reference_id || session.metadata?.user_id;
    if (!userId) return;

    const amountCents = session.amount_total || 0;
    const stripePaymentIntentId = typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id || null;

    await this.prisma.invoice.create({
      data: {
        id: uuidv4(),
        userId,
        stripeInvoiceId: session.id,
        stripePaymentIntentId,
        amountCents,
        currency: session.currency || 'cad',
        status: 'paid',
        description: session.metadata?.product || 'payment',
        paidAt: new Date(),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        id: uuidv4(),
        userId,
        action: 'payment_succeeded',
        resourceType: 'invoice',
        metadata: { amount: amountCents, product: session.metadata?.product },
      },
    });

    // Create timeline event
    await this.prisma.timelineEvent.create({
      data: {
        id: uuidv4(),
        userId,
        eventType: 'payment',
        title: `Payment Received: ${session.metadata?.product || 'service'}`,
        description: `Payment of $${(amountCents / 100).toFixed(2)} CAD processed successfully.`,
        occurredAt: new Date(),
      },
    });
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
