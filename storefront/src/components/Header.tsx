import Link from 'next/link';
import { SHOP_IDENTITY, COMMERCE } from '@clothing-erp/shared';
import CartBadge from './CartBadge';
import { getShopConfig, getFacets } from '@/lib/api';

export default async function Header() {
  const [cfg, facets] = await Promise.all([getShopConfig(), getFacets()]);
  const checkoutEnabled = Boolean(cfg.success && cfg.data.checkoutEnabled);

  // The categories come from the database rather than a hardcoded list. This
  // shop's real catalogue is cord sets, dresses and one-pieces — a Girls/Boys
  // split would have shown two links, one of them permanently empty.
  const categories: { name: string; slug: string }[] =
    facets.success ? facets.data.categories : [];

  const nav = [
    { label: 'New in', href: '/c/all?sort=new' },
    ...categories.map((c) => ({ label: c.name, href: `/c/${c.slug}` })),
    { label: 'Shop by age', href: '/age' },
    { label: 'Size guide', href: '/size-guide' },
  ];

  return (
    <header>
      {/* The announcement bar the register expects. Free delivery is a real
          promise here — v1 charges nothing for it. See shop-config.ts. */}
      <div className="bg-brand text-center text-[13px] text-white">
        <div className="shell py-2.5">
          {checkoutEnabled ? (
            <>
              Flat {COMMERCE.prepaidDiscountPercent}% off on prepaid orders
              <span className="mx-2 opacity-50">·</span>
              Free delivery on every order
              <span className="mx-2 opacity-50">·</span>
              Exchange within {COMMERCE.exchangeWindowDays} days
            </>
          ) : (
            <>
              Free delivery on every order
              <span className="mx-2 opacity-50">·</span>
              Order on WhatsApp — online payment opening soon
            </>
          )}
        </div>
      </div>

      <div className="border-b border-line">
        <div className="shell flex items-center gap-6 py-4">
          <Link href="/" className="flex flex-col leading-none">
            <span className="font-display text-[22px] sm:text-2xl">{SHOP_IDENTITY.name}</span>
            <span className="mt-1.5 text-[9.5px] uppercase tracking-[0.26em] text-muted">
              {SHOP_IDENTITY.tagline}
            </span>
          </Link>

          <form action="/search" className="hidden flex-1 items-center gap-2 border border-rule px-3 py-2.5 md:flex">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8c8279" strokeWidth="1.5" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="M16.5 16.5 21 21" />
            </svg>
            <input
              name="q"
              placeholder="Search frocks, kurta sets, lehengas…"
              aria-label="Search products"
              className="w-full text-[14px] outline-none placeholder:text-muted"
            />
          </form>

          <div className="ml-auto flex items-center gap-5 md:ml-0">
            <Link href="/account" className="flex items-center gap-1.5 text-[14px] hover:text-brand">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
                <circle cx="12" cy="8" r="4" />
                <path d="M4.5 20c0-4.1 3.4-6.5 7.5-6.5s7.5 2.4 7.5 6.5" />
              </svg>
              <span className="hidden sm:inline">Account</span>
            </Link>
            {checkoutEnabled && <CartBadge />}
          </div>
        </div>
      </div>

      <nav aria-label="Categories" className="border-b border-line">
        <div className="shell flex justify-start gap-6 overflow-x-auto py-3.5 text-[13.5px] uppercase tracking-[0.1em] sm:justify-center sm:gap-8">
          {nav.map((item) => (
            <Link key={item.href} href={item.href} className="whitespace-nowrap hover:text-brand">
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  );
}
