import Link from 'next/link';
import { listProducts, getFacets } from '@/lib/api';
import ProductCard from '@/components/ProductCard';
import TrustStrip from '@/components/TrustStrip';
import AgeTiles from '@/components/AgeTiles';
import Empty from '@/components/Empty';
import { CATALOGUE, DELIVERY } from '@clothing-erp/shared';

export const revalidate = 300;

export default async function HomePage() {
  const [newIn, facets] = await Promise.all([
    listProducts({ limit: String(CATALOGUE.homeNewInCount), sort: 'new' }),
    getFacets(),
  ]);

  const products = newIn.success ? newIn.data : [];
  const categories = facets.success ? facets.data.categories : [];

  return (
    <>
      {/* Hero */}
      <section className="relative flex min-h-[380px] items-center bg-gradient-to-br from-[#f6e9df] via-[#eed7c8] to-[#e3c0b1] lg:min-h-[440px]">
        <div className="shell flex w-full flex-col items-start gap-4 py-12 lg:w-1/2 lg:py-0">
          <span className="text-[11px] uppercase tracking-[0.24em] text-brand">
            New arrivals every Friday
          </span>
          <h1 className="max-w-[16ch] text-[34px] leading-[1.15] sm:text-[44px]">
            Ethnic wear that survives a whole day of running about
          </h1>
          <p className="max-w-[40ch] text-[16px] text-body">
            Frocks, lehenga cholis, kurta sets and sherwanis — sizes 12 to 36, for six
            months old to sixteen years.
          </p>
          <Link
            href="/c/all"
            className="mt-1 bg-ink px-8 py-4 text-[12.5px] uppercase tracking-[0.18em] text-white hover:bg-black"
          >
            Shop new in
          </Link>
        </div>
      </section>

      <AgeTiles />
      <TrustStrip />

      {/* New this week */}
      <section className="shell py-11">
        <div className="mb-6 flex items-baseline justify-between">
          <h2 className="font-display text-[26px]">New this week</h2>
          <Link href="/c/all" className="border-b border-rule pb-0.5 text-[13px] uppercase tracking-[0.1em] hover:border-ink">
            View all
          </Link>
        </div>

        {products.length === 0 ? (
          <Empty
            title="Nothing listed online just yet"
            body="Our stock is on the rails in the shop while we photograph it. New pieces go up here every Friday — or message us and we will send you photos of anything you are after."
            cta={{ label: 'Message the shop', href: '/policies/contact' }}
          />
        ) : (
          <div className="grid grid-cols-2 gap-5 sm:gap-6 lg:grid-cols-4">
            {products.map((p: any) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </section>

      {/* Categories */}
      {categories.length > 0 && (
        <section className="shell pb-11">
          <h2 className="mb-6 font-display text-[26px]">Shop by category</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {categories.map((c: any) => (
              <Link key={c.slug} href={`/c/${c.slug}`} className="group flex flex-col gap-2.5">
                <div className="aspect-[3/4] bg-[#f1e8df] transition-colors group-hover:bg-shell" />
                <span className="text-[14px] group-hover:text-brand">{c.name}</span>
                <span className="text-[12px] text-muted">
                  {c.count} {c.count === 1 ? 'style' : 'styles'}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Brand band */}
      <section className="bg-sand py-12">
        <div className="shell grid items-center gap-12 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <h2 className="text-[30px] leading-tight">Dressed up, but still able to play</h2>
            <p className="max-w-[46ch] text-[15.5px] text-body">
              Every frock and kurta set here has been through the same test: can a child
              wear it to a wedding at seven in the evening and still be comfortable at
              eleven? Soft linings, no scratchy zari against the skin, and elastic where a
              stiff waistband would dig in.
            </p>
            <p className="max-w-[46ch] text-[15.5px] text-body">
              This website and the shop share one stock room, so what you see here is what
              is actually on the rail. Dispatched from {DELIVERY.originCity}.
            </p>
          </div>
          <div className="flex aspect-[4/3] items-center justify-center bg-[#f0e5da] text-[10px] uppercase tracking-[0.22em] text-[#bbaa9c]">
            Shop photograph
          </div>
        </div>
      </section>
    </>
  );
}
