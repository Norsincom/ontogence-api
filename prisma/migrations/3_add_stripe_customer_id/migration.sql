-- Migration: 3_add_stripe_customer_id
-- Adds stripe_customer_id to users table for unified account linkage.
-- This field stores the Stripe Customer ID, ensuring all purchases from
-- a given user attach to the same Stripe customer record (no guest checkouts,
-- no duplicate customers, no fragmented purchase histories).

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "stripe_customer_id" TEXT UNIQUE;
