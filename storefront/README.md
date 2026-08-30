# Storefront — Sabiha's Ethnic

Public e-commerce site for the kids ethnic wear shop, sharing one database with
the POS/ERP in this monorepo.

Next.js App Router, server-rendered so product pages are actually indexable.

## Run it

```bash
# from the repo root — backend on :3000, storefront on :3001
npm run dev:shop

# demo catalogue (development only, never against production)
cd backend && DATABASE_URL=... npx ts-node --transpile-only prisma/seed-shop-demo.ts
```

Open http://localhost:3001.

## How it fits together

```
browser → /api/shop/*  (Next route handler, holds the httpOnly cookies)
                     ↓
         Express :3000 /api/shop/v1  ← same process as the POS API
                     ↓
                 PostgreSQL          ← one database, one stock room
```

The browser never calls the API directly. Everything goes through the proxy in
`src/app/api/shop/[...path]/route.ts` so the shopper's access and refresh tokens
stay in httpOnly cookies, out of reach of any script on the page.

## Things worth knowing

- **`SHOP_SITE_URL` is baked in at build time** — it ends up in `robots.txt` and
  every canonical URL. Set it before `next build`, not only in the systemd unit.
- **Catalogue pages are cached for 60s; anything with stock or a cart is never
  cached.** A cached availability number is a wrong availability number.
- **Sizes never appear without their age.** `22` means nothing to a parent;
  `22 · 4 years` does. See `src/components/SizePicker.tsx`.
- **The only timer a shopper sees** is the hold on their own bag, and only once
  stock is genuinely held for them. It is not a pressure device.

Assumptions and their env vars: [`docs/ecommerce/ASSUMPTIONS.md`](../docs/ecommerce/ASSUMPTIONS.md).
