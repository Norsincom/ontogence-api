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

  /**
   * UNIFIED ACCOUNT LINKAGE — findOrCreateStripeCustomer
   *
   * This is the single source of truth for Stripe customer identity.
   * It guarantees one Stripe customer per email address, forever.
   *
   * Lookup priority:
   *   1. DB: user.stripeCustomerId (fastest — already linked)
   *   2. Stripe: customer list by email (catches pre-existing customers)
   *   3. Create new Stripe customer and persist stripeCustomerId to DB
   *
   * This prevents:
   *   - Guest checkouts (no customer object)
   *   - Duplicate Stripe customers for the same email
   *   - Returning users being classified as Guest
   *   - Fragmented purchase histories across multiple customer records
   */
  /**
   * Public alias for findOrCreateStripeCustomer — called by the Clerk webhook
   * on user.created to immediately provision a Stripe customer for every new
   * ONTOGENCE user, preventing all future guest checkouts and duplicates.
   */
  async ensureStripeCustomer(userId: string, userEmail: string, userName: string): Promise<string> {
    return this.findOrCreateStripeCustomer(userId, userEmail, userName);
  }

  private async findOrCreateStripeCustomer(
    userId: string,
    userEmail: string,
    userName: string,
  ): Promise<string> {
    if (!stripe) throw new Error('Stripe is not configured');

    // Step 1: Check if we already have a stripeCustomerId stored in the DB
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { stripeCustomerId: true, email: true, name: true },
    });

    if (user?.stripeCustomerId) {
      this.logger.log(`[Stripe] Reusing existing stripeCustomerId=${user.stripeCustomerId} for userId=${userId}`);
      return user.stripeCustomerId;
    }

    // Step 2: Search Stripe by email — catches customers created before this field existed
    const emailToSearch = userEmail || user?.email || '';
    if (emailToSearch) {
      const existingCustomers = await stripe.customers.list({ email: emailToSearch, limit: 5 });
      if (existingCustomers.data.length > 0) {
        // Use the most recently created customer (first in list, Stripe returns newest first)
        const existingCustomer = existingCustomers.data[0];
        this.logger.log(`[Stripe] Found existing Stripe customer by email: id=${existingCustomer.id} email=${emailToSearch}`);

        // Persist to DB so future lookups hit Step 1 (fast path)
        await this.prisma.user.update({
          where: { id: userId },
          data: { stripeCustomerId: existingCustomer.id },
        }).catch(err => this.logger.warn(`[Stripe] Failed to persist stripeCustomerId: ${err.message}`));

        return existingCustomer.id;
      }
    }

    // Step 3: No existing customer found — create one and persist
    // Look up the user's ontId to include in Stripe metadata
    const userRecord = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { ontId: true },
    }).catch(() => null);

    const newCustomer = await stripe.customers.create({
      email: emailToSearch,
      name: userName || user?.name || undefined,
      metadata: {
        ontogence_user_id: userId,
        ont_id: userRecord?.ontId || '',
      },
    });

    this.logger.log(`[Stripe] Created new Stripe customer: id=${newCustomer.id} email=${emailToSearch} userId=${userId}`);

    // Persist stripeCustomerId to DB
    await this.prisma.user.update({
      where: { id: userId },
      data: { stripeCustomerId: newCustomer.id },
    }).catch(err => this.logger.warn(`[Stripe] Failed to persist new stripeCustomerId: ${err.message}`));

    return newCustomer.id;
  }

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

  /**
   * Multi-product cart checkout — accepts an array of product keys.
   *
   * ACCOUNT LINKAGE: Uses findOrCreateStripeCustomer() to ensure all purchases
   * attach to the same Stripe customer record, regardless of product type or
   * purchase history. No guest checkouts are possible.
   */
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

    // CRITICAL: Resolve the unified Stripe customer before creating any session.
    // This is the enforcement point for the one-customer-per-user rule.
    const stripeCustomerId = await this.findOrCreateStripeCustomer(userId, userEmail, userName);

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
        customer: stripeCustomerId,   // UNIFIED: attach to existing customer, never guest
        allow_promotion_codes: true,
        line_items: [{ price: PRODUCTS.vaultAccess.priceId, quantity: 1 }],
        client_reference_id: userId,
        metadata: {
          user_id: userId,
          customer_email: userEmail,
          customer_name: userName,
          products: 'vaultAccess',
          has_vault: 'true',
        },
        success_url: successUrl,
        cancel_url: cancelUrl,
      });
      vaultSessionUrl = vaultSess.url;
    }

    // Determine mode for the primary session
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

    const thisSessionHasVault = isSubscriptionOnly && recurringKeys.includes('vaultAccess');

    const session = await stripe.checkout.sessions.create({
      mode,
      customer: stripeCustomerId,   // UNIFIED: attach to existing customer, never guest
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
    // Resolve Stripe customer ID early — needed for fallback user resolution
    const sessionCustomerId = typeof session.customer === 'string'
      ? session.customer
      : (session.customer as any)?.id || null;

    // PRIMARY: resolve userId from client_reference_id or metadata
    let userId = session.client_reference_id || session.metadata?.user_id;

    // FALLBACK 1: look up by email — handles legacy sessions and edge cases
    if (!userId) {
      const email = session.metadata?.customer_email || session.customer_email || '';
      if (email) {
        const userByEmail = await this.prisma.user.findUnique({ where: { email } }).catch(() => null);
        if (userByEmail) {
          userId = userByEmail.id;
          this.logger.log(`[Stripe] Resolved userId=${userId} by email fallback for session=${session.id}`);
        }
      }
    }

    // FALLBACK 2: look up by stripeCustomerId — covers Stripe Payment Links where
    // client_reference_id is not set but a named customer object is attached
    if (!userId && sessionCustomerId) {
      const userByCustomer = await this.prisma.user.findFirst({
        where: { stripeCustomerId: sessionCustomerId },
      }).catch(() => null);
      if (userByCustomer) {
        userId = userByCustomer.id;
        this.logger.log(`[Stripe] Resolved userId=${userId} by stripeCustomerId fallback for session=${session.id}`);
      }
    }

    if (!userId) {
      this.logger.warn('[Stripe] checkout.session.completed: no userId in client_reference_id, metadata, or email lookup');
      return;
    }

    // Persist stripeCustomerId to user record if we have it from the session
    if (sessionCustomerId) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { stripeCustomerId: sessionCustomerId },
      }).catch(err => this.logger.warn(`[Stripe] Failed to persist stripeCustomerId on checkout complete: ${err.message}`));
    }

    // RACE CONDITION GUARD: Ensure the user record exists before creating FK-dependent records.
    // The Clerk webhook that creates the user may not have fired yet when Stripe fires.
    const userExists = await this.prisma.user.findUnique({ where: { id: userId } }).catch(() => null);
    if (!userExists) {
      const email = session.metadata?.customer_email || session.customer_email || '';
      const name = session.metadata?.customer_name || '';

      // Before creating a stub, check if a user with this email already exists
      // (handles the case where the Clerk webhook created the user with a different ID)
      if (email) {
        const existingByEmail = await this.prisma.user.findUnique({ where: { email } }).catch(() => null);
        if (existingByEmail) {
          this.logger.log(`[Stripe] Found existing user by email for stub creation — using id=${existingByEmail.id}`);
          userId = existingByEmail.id;
          // Persist stripeCustomerId to the found user
          if (sessionCustomerId) {
            await this.prisma.user.update({
              where: { id: existingByEmail.id },
              data: { stripeCustomerId: sessionCustomerId },
            }).catch(() => {});
          }
        } else {
          this.logger.warn(`[Stripe] User ${userId} not in DB — creating stub record from checkout metadata`);
          try {
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            let ontId = 'ONT-';
            for (let i = 0; i < 8; i++) ontId += chars[Math.floor(Math.random() * chars.length)];
            await this.prisma.user.create({
              data: {
                id: userId,
                clerkId: userId,
                email,
                name,
                role: 'client',
                ontId,
                stripeCustomerId: sessionCustomerId || undefined,
                onboardingDone: false,
              },
            });
            this.logger.log(`[Stripe] Created stub user for ${userId} | email=${email} | ontId=${ontId}`);
          } catch (createErr: any) {
            this.logger.error(`[Stripe] Failed to create stub user for ${userId}: ${createErr.message}`);
          }
        }
      }
    }

    this.logger.log(`[Stripe] checkout.session.completed: userId=${userId} mode=${session.mode} has_vault=${session.metadata?.has_vault}`);

    const amountCents = session.amount_total || 0;
    const stripePaymentIntentId = typeof session.payment_intent === 'string'
      ? session.payment_intent
      : (session.payment_intent as any)?.id || null;

    // ── Fetch real Stripe line items for accurate description and vault detection ──
    // NEVER use metadata.products — it may be stale or incorrect.
    // Always use the actual line items from Stripe as the source of truth.
    let lineItemNames: string[] = [];
    let hasVaultLineItem = false;
    try {
      if (stripe) {
        const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
          expand: ['data.price.product'],
          limit: 20,
        });
        for (const item of lineItems.data) {
          const product = item.price?.product;
          const name = (product && typeof product === 'object' && 'name' in product)
            ? (product as any).name as string
            : item.description || 'Service';
          lineItemNames.push(name);
          // Vault Access is only present if the actual line item is the vault product
          if (item.price?.id === PRODUCTS.vaultAccess.priceId) {
            hasVaultLineItem = true;
          }
        }
        this.logger.log(`[Stripe] Line items for session=${session.id}: ${lineItemNames.join(', ')}`);
      }
    } catch (liErr: any) {
      this.logger.warn(`[Stripe] Could not fetch line items for session=${session.id}: ${liErr.message}`);
    }

    // Fallback: if line items unavailable, use has_vault metadata flag only
    const hasVault = hasVaultLineItem ||
      (lineItemNames.length === 0 && session.metadata?.has_vault === 'true') ||
      session.mode === 'subscription';

    // Build human-readable description from real line item names
    const invoiceDescription = lineItemNames.length > 0
      ? lineItemNames.join(', ')
      : (session.metadata?.has_vault === 'true' ? 'Vault Access' : 'Protocol');

    // Upsert invoice — stripeInvoiceId is unique, so duplicate webhooks are safe
    await this.prisma.invoice.upsert({
      where: { stripeInvoiceId: session.id },
      update: { status: 'paid', paidAt: new Date(), description: invoiceDescription },
      create: {
        id: uuidv4(),
        userId,
        stripeInvoiceId: session.id,
        stripePaymentIntentId,
        amountCents,
        currency: session.currency || 'cad',
        status: 'paid',
        description: invoiceDescription,
        paidAt: new Date(),
      },
    });

    // If vault was purchased, create/activate subscription record
    if (hasVault) {
      const stripeSubscriptionId = typeof session.subscription === 'string'
        ? session.subscription
        : (session.subscription as any)?.id || `vault-${userId}-${Date.now()}`;

      this.logger.log(`[Stripe] Activating vault for userId=${userId} stripeSubId=${stripeSubscriptionId}`);

      const existingBySub = stripeSubscriptionId
        ? await this.prisma.subscription.findUnique({ where: { stripeSubscriptionId } }).catch(() => null)
        : null;

      if (existingBySub) {
        await this.prisma.subscription.update({
          where: { stripeSubscriptionId },
          data: { status: 'active', currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
        });
      } else {
        const existingActive = await this.prisma.subscription.findFirst({ where: { userId, status: 'active' } });
        if (!existingActive) {
          await this.prisma.subscription.create({
            data: {
              id: uuidv4(),
              userId,
              stripeCustomerId: sessionCustomerId || undefined,
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
        metadata: { amount: amountCents, products: invoiceDescription },
      },
    });

    await this.prisma.timelineEvent.create({
      data: {
        id: uuidv4(),
        userId,
        eventType: 'payment',
        title: `Payment Received`,
        description: `Payment of $${(amountCents / 100).toFixed(2)} CAD processed successfully for: ${invoiceDescription}.`,
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
    const stripeStatus = subscription.status;
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

  /**
   * Self-healing sync: reconcile a user's Stripe subscriptions with the local DB.
   * Called on-demand from GET /stripe/sync (authenticated).
   *
   * ACCOUNT LINKAGE: Uses findOrCreateStripeCustomer() to ensure the user's
   * stripeCustomerId is always persisted before syncing subscriptions.
   */
  async syncSubscriptionForUser(userId: string, userEmail: string) {
    if (!stripe) return { synced: false, reason: 'Stripe not configured' };

    // Ensure stripeCustomerId is persisted for this user
    let stripeCustomerId: string | null = null;
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { stripeCustomerId: true, name: true },
      });
      if (user?.stripeCustomerId) {
        stripeCustomerId = user.stripeCustomerId;
      } else {
        // Try to find by email in Stripe
        const customers = await stripe.customers.list({ email: userEmail, limit: 5 });
        if (customers.data.length > 0) {
          stripeCustomerId = customers.data[0].id;
          await this.prisma.user.update({
            where: { id: userId },
            data: { stripeCustomerId },
          }).catch(() => {});
        }
      }
    } catch (err: any) {
      this.logger.warn(`[Stripe Sync] Customer lookup failed: ${err.message}`);
    }

    // Find Stripe customer by email (broad search across all customers)
    const customers = await stripe.customers.list({ email: userEmail, limit: 5 });
    if (!customers.data.length) {
      return { synced: false, reason: 'No Stripe customer found for this email' };
    }

    // Check all customers for active subscriptions
    for (const customer of customers.data) {
      const subs = await stripe.subscriptions.list({ customer: customer.id, status: 'active', limit: 5 });
      for (const sub of subs.data) {
        const existing = await this.prisma.subscription.findUnique({ where: { stripeSubscriptionId: sub.id } }).catch(() => null);
        if (!existing) {
          this.logger.log(`[Stripe Sync] Creating missing subscription for userId=${userId} stripeSubId=${sub.id}`);
          await this.prisma.subscription.create({
            data: {
              id: require('crypto').randomUUID(),
              userId,
              stripeCustomerId: customer.id,
              stripeSubscriptionId: sub.id,
              stripePriceId: sub.items.data[0]?.price.id || '',
              status: 'active',
              currentPeriodStart: new Date(sub.current_period_start * 1000),
              currentPeriodEnd: new Date(sub.current_period_end * 1000),
            },
          });
          return { synced: true, subscriptionId: sub.id };
        } else if (existing.status !== 'active') {
          await this.prisma.subscription.update({
            where: { stripeSubscriptionId: sub.id },
            data: { status: 'active', currentPeriodEnd: new Date(sub.current_period_end * 1000) },
          });
          return { synced: true, subscriptionId: sub.id, updated: true };
        } else {
          return { synced: true, subscriptionId: sub.id, alreadyActive: true };
        }
      }
    }

    return { synced: false, reason: 'No active Stripe subscription found' };
  }
}
