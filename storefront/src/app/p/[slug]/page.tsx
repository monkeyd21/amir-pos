import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProduct, getShopConfig } from '@/lib/api';
import BuyPanel from '@/components/BuyPanel';
import ProductCard from '@/components/ProductCard';
import { rupees, percentOff } from '@/lib/format';
import { SITE_URL } from '@/lib/config';
import { COMMERCE } from '@clothing-erp/shared';

export const revalidate = 60;

type Params = { params: { slug: string } };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const res = await getProduct(params.slug);
  if (!res.success) return { title: 'Not found' };
  const p = res.data;
  return {
    title: p.metaTitle || p.name,
    description:
      p.metaDescription ||
      `${p.name} — sizes ${p.madeInSizes[0]?.size} to ${p.madeInSizes[p.madeInSizes.length - 1]?.size}. Free delivery, 7-day exchange.`,
    alternates: { canonical: `/p/${p.slug}` },
    openGraph: {
      title: p.name,
      images: p.images.length ? [{ url: p.images[0].url }] : [],
      type: 'website',
    },
  };
}

export default async function ProductPage({ params }: Params) {
  const [res, cfg] = await Promise.all([getProduct(params.slug), getShopConfig()]);
  if (!res.success) notFound();
  const p = res.data;
  const checkoutEnabled = Boolean(cfg.success && cfg.data.checkoutEnabled);

  const off = percentOff(p.mrpFrom, p.priceFrom);

  // A sold-out product keeps its URL and returns 200 with an out-of-stock
  // state — a 404 would throw away the search equity every time a size runs out.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    description: p.description ?? undefined,
    image: p.images.map((i: any) => i.url),
    brand: { '@type': 'Brand', name: p.brand?.name ?? 'Sabiha’s Ethnic' },
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: 'INR',
      lowPrice: p.priceFrom,
      offerCount: p.variants.length,
      availability: p.inStock
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
      url: `${SITE_URL}/p/${p.slug}`,
    },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="shell py-6">
        <nav aria-label="Breadcrumb" className="mb-4 text-[12.5px] text-muted">
          <Link href="/" className="hover:text-ink">Home</Link>
          {p.category && (
            <>
              {' / '}
              <Link href={`/c/${p.category.slug}`} className="hover:text-ink">{p.category.name}</Link>
            </>
          )}
          {' / '}
          <span>{p.name}</span>
        </nav>

        <div className="grid gap-10 lg:grid-cols-[1.15fr_1fr]">
          {/* Gallery */}
          <div className="flex flex-col gap-2.5">
            <div className="aspect-[4/5] bg-shell">
              {p.images[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.images[0].url}
                  alt={p.images[0].alt || p.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="flex h-full items-center justify-center text-[10px] uppercase tracking-[0.2em] text-[#bbaa9c]">
                  Photograph
                </span>
              )}
            </div>
            {p.images.length > 1 && (
              <div className="grid grid-cols-4 gap-2.5">
                {p.images.slice(1, 5).map((img: any, i: number) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={img.url}
                    alt={img.alt || `${p.name} view ${i + 2}`}
                    className="aspect-[4/5] w-full object-cover"
                  />
                ))}
              </div>
            )}
          </div>

          {/* Buy column */}
          <div className="flex flex-col gap-5">
            <div>
              <h1 className="text-[28px] leading-tight sm:text-[31px]">{p.name}</h1>
              {p.category && (
                <p className="mt-2 text-[13px] text-muted">
                  {[p.audience, p.category.name].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>

            <div>
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="tnum text-[30px] font-medium">{rupees(p.priceFrom)}</span>
                {off > 0 && (
                  <>
                    <span className="tnum text-[17px] text-[#a49a90] line-through">{rupees(p.mrpFrom)}</span>
                    <span className="bg-brand px-2 py-0.5 text-[12px] text-white">{off}% off</span>
                  </>
                )}
              </div>
              <p className="mt-1.5 text-[13px] text-muted">
                Inclusive of all taxes · {COMMERCE.prepaidDiscountPercent}% more off on prepaid
              </p>
            </div>

            <BuyPanel
              productName={p.name}
              variants={p.variants}
              codBlocked={p.codBlocked}
              checkoutEnabled={checkoutEnabled}
            />

            {p.description && (
              <p className="border-t border-line pt-5 text-[14.5px] leading-relaxed text-body">
                {p.description}
              </p>
            )}
          </div>
        </div>

        {p.related?.length > 0 && (
          <section className="mt-14 border-t border-line pt-9">
            <h2 className="mb-6 font-display text-[26px]">You may also like</h2>
            <div className="grid grid-cols-2 gap-5 sm:gap-6 lg:grid-cols-4">
              {p.related.map((r: any) => (
                <ProductCard key={r.id} product={r} />
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
