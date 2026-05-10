import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2025-02-24.acacia' as any });

export const PRODUCTS = {
  registration: {
    name: 'Ontogence Registration Fee',
    priceId: process.env.STRIPE_REGISTRATION_PRICE_ID || '',
    amount: 25000, // $250 CAD in cents
    currency: 'cad',
  },
  protocol: {
    name: 'Personalised Protocol Delivery',
    priceId: process.env.STRIPE_PROTOCOL_PRICE_ID || '',
    amount: 65000, // $650 CAD in cents
    currency: 'cad',
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
    return stripe.webhooks.constructEvent(payload, signature, process.env.STRIPE_WEBHOOK_SECRET || '');
  }
}
