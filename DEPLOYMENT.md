# Ontogence Deployment Guide

## Architecture

```
ontogence-api (NestJS)  →  Render (Oregon)
ontogence-web (Next.js) →  Vercel (iad1)
Database                →  Supabase (West US, PostgreSQL)
File Storage            →  Supabase Storage
Auth                    →  Clerk
Payments                →  Stripe (Live)
Email                   →  Resend
```

---

## 1. Backend — Render Setup

### Create Service
1. Go to [render.com](https://render.com) → New → Web Service
2. Connect `Norsincom/ontogence-api` GitHub repository
3. Set **Build Command**: `pnpm install && npx prisma generate && pnpm build`
4. Set **Start Command**: `node dist/main.js`
5. Set **Runtime**: Node 22

### Environment Variables (Render Dashboard → Environment)

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `PORT` | `3001` |
| `DATABASE_URL` | `postgresql://postgres.treeujtluzsfoktsrwlr:[PASSWORD]@aws-0-us-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true` |
| `DIRECT_URL` | `postgresql://postgres:[PASSWORD]@db.treeujtluzsfoktsrwlr.supabase.co:5432/postgres` |
| `CLERK_SECRET_KEY` | `sk_live_TMVJ2oKtwWWyKyHp0fWBx1np3gbxpDBqzx1He41g5K` |
| `CLERK_WEBHOOK_SECRET` | *(from Clerk Dashboard → Webhooks, after creating endpoint)* |
| `STRIPE_SECRET_KEY` | *(live key from Stripe Dashboard)* |
| `STRIPE_WEBHOOK_SECRET` | *(from Stripe Dashboard → Developers → Webhooks)* |
| `RESEND_API_KEY` | `re_F6B2Lgvg_8JmPxQcX727jq5kJpUurEsaR` |
| `SUPABASE_URL` | `https://treeujtluzsfoktsrwlr.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRyZWV1anRsdXpzZm9rdHNyd2xyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODI1NTAyMywiZXhwIjoyMDkzODMxMDIzfQ.moS0n4JLX8p7aC65Sd9otGjOOrTJnf8utn4ZYOXjfmg` |
| `FRONTEND_URL` | `https://ontogence.com` |

---

## 2. Frontend — Vercel Setup

### Deploy
1. Go to [vercel.com](https://vercel.com) → New Project
2. Import `Norsincom/ontogence-web` GitHub repository
3. Framework: **Next.js** (auto-detected)
4. Root Directory: `/` (or `frontend/` if monorepo)

### Environment Variables (Vercel Dashboard → Settings → Environment Variables)

| Key | Value |
|-----|-------|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_Y2xlcmsub250b2dlbmNlLmNvbSQ` |
| `CLERK_SECRET_KEY` | `sk_live_TMVJ2oKtwWWyKyHp0fWBx1np3gbxpDBqzx1He41g5K` |
| `NEXT_PUBLIC_API_URL` | `https://ontogence-api.onrender.com` *(update after Render deploy)* |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | *(live publishable key from Stripe)* |

### Custom Domain
1. Vercel → Project → Settings → Domains
2. Add `ontogence.com` and `www.ontogence.com`
3. Update DNS at your registrar to point to Vercel's nameservers

---

## 3. Clerk Configuration

### After Render is deployed:
1. Go to [Clerk Dashboard](https://dashboard.clerk.com) → Webhooks
2. Add endpoint: `https://ontogence-api.onrender.com/webhooks/clerk`
3. Subscribe to events: `user.created`, `user.updated`, `user.deleted`
4. Copy the **Signing Secret** → add as `CLERK_WEBHOOK_SECRET` in Render

### Allowed Redirect URLs
In Clerk Dashboard → Paths:
- Sign-in URL: `/sign-in`
- Sign-up URL: `/sign-up`
- After sign-in: `/dashboard`
- After sign-up: `/dashboard`

---

## 4. Stripe Configuration

### After Render is deployed:
1. Go to [Stripe Dashboard](https://dashboard.stripe.com) → Developers → Webhooks
2. Add endpoint: `https://ontogence-api.onrender.com/stripe/webhook`
3. Subscribe to: `checkout.session.completed`, `payment_intent.succeeded`
4. Copy **Signing Secret** → add as `STRIPE_WEBHOOK_SECRET` in Render

### Test Card
Use `4242 4242 4242 4242` with any future expiry and any CVC.

---

## 5. Supabase Storage

The vault module uses Supabase Storage bucket `vault`. Create it:
1. Supabase Dashboard → Storage → New Bucket
2. Name: `vault`
3. Public: **No** (private bucket)
4. File size limit: 50MB

---

## 6. Post-Deploy Checklist

- [ ] Render service is running and `/health` returns 200
- [ ] Vercel deployment is live at ontogence.com
- [ ] Clerk webhook endpoint is registered and verified
- [ ] Stripe webhook endpoint is registered and verified
- [ ] Supabase `vault` storage bucket created
- [ ] DNS for ontogence.com points to Vercel
- [ ] Test registration flow end-to-end
- [ ] Test file upload to vault
- [ ] Test Stripe checkout with test card
- [ ] Promote first user to `super_admin` via Supabase SQL Editor:
  ```sql
  UPDATE users SET role = 'super_admin' WHERE email = 'your@email.com';
  ```
