import type { Metadata } from 'next';
import Link from 'next/link';
import { listProducts, getFacets } from '@/lib/api';
import ProductCard from '@/components/ProductCard';
import Empty from '@/components/Empty';
import { AGE_BANDS } from '@clothing-erp/shared';

export const revalidate = 60;

type Params = { params: { category: string }; searchParams: Record<string, string | undefined> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const facets = await getFacets();
  const cat = facets.success
    ? facets.data.categories.find((c: any) => c.slug === params.category)
    : null;
  const name = cat?.name ?? (params.category === 'all' ? 'All kidswear' : params.category);
  return {
    title: name,
    description: `${name} for children — sizes 12 to 36, six months to sixteen years.`,
    alternates: { canonical: `/c/${params.category}` },
  };
}

export default async function CategoryPage({ params, searchParams }: Params) {
  const isAll = params.category === 'all';

  const [res, facets] = await Promise.all([
    listProducts({
      category: isAll ? undefined : params.category,
      age: searchParams.age,
      size: searchParams.size,
      sort: searchParams.sort,
      page: searchParams.page,
    }),
    getFacets(),
  ]);

  const products = res.success ? res.data : [];
  const meta = res.meta;
  const categories = facets.success ? facets.data.categories : [];
  const activeCat = categories.find((c: any) => c.slug === params.category);
  const title = activeCat?.name ?? (isAll ? 'Everything' : params.category);

  const qs = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(
      Object.entries({ ...searchParams, ...patch }).filter(([, v]) => v) as [string, string][]
    );
    return `/c/${params.category}${next.toString() ? `?${next}` : ''}`;
  };

  return (
    <div className="shell py-8">
      <nav aria-label="Breadcrumb" className="mb-4 text-[12.5px] text-muted">
        <Link href="/" className="hover:text-ink">Home</Link> / {title}
      </nav>

      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-[30px]">{title}</h1>
        {meta && (
          <span className="text-[13px] text-muted">
            {meta.total} {meta.total === 1 ? 'style' : 'styles'}
          </span>
        )}
      </div>

      {/* Age filter — the axis parents actually use */}
      <div className="mb-7 flex flex-col gap-3 border-y border-line py-4">
        <span className="text-[11px] uppercase tracking-[0.14em] text-muted">Filter by age</span>
        <div className="flex flex-wrap gap-2">
          <Link
            href={qs({ age: undefined })}
            className={`border px-3.5 py-2 text-[13px] ${
              !searchParams.age ? 'border-ink bg-ink text-white' : 'border-rule hover:border-ink'
            }`}
          >
            All ages
          </Link>
          {AGE_BANDS.map((b) => (
            <Link
              key={b.slug}
              href={qs({ age: b.slug })}
              className={`border px-3.5 py-2 text-[13px] ${
                searchParams.age === b.slug
                  ? 'border-ink bg-ink text-white'
                  : 'border-rule hover:border-ink'
              }`}
            >
              {b.label}
            </Link>
          ))}
        </div>
      </div>

      {products.length === 0 ? (
        <Empty
          title="Nothing here to show yet"
          body="Either this category is still being photographed, or the age filter is narrower than our stock. Try a different age, or message the shop — we will tell you what is on the rail."
          cta={{ label: 'See everything', href: '/c/all' }}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-5 sm:gap-6 lg:grid-cols-4">
            {products.map((p: any) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>

          {meta && meta.totalPages > 1 && (
            <nav className="mt-10 flex items-center justify-center gap-3 text-[13px]">
              {meta.page > 1 && (
                <Link href={qs({ page: String(meta.page - 1) })} className="border border-rule px-4 py-2.5 hover:border-ink">
                  Previous
                </Link>
              )}
              <span className="tnum text-muted">Page {meta.page} of {meta.totalPages}</span>
              {meta.page < meta.totalPages && (
                <Link href={qs({ page: String(meta.page + 1) })} className="border border-rule px-4 py-2.5 hover:border-ink">
                  Next
                </Link>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
