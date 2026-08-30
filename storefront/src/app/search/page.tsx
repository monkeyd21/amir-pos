import type { Metadata } from 'next';
import { listProducts } from '@/lib/api';
import ProductCard from '@/components/ProductCard';
import Empty from '@/components/Empty';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Search',
  robots: { index: false, follow: true },
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const q = (searchParams.q || '').trim();
  const res = q ? await listProducts({ q }) : { success: true, data: [] as any[] };
  const products = res.success ? res.data : [];

  return (
    <div className="shell py-9">
      <h1 className="mb-6 text-[28px]">
        {q ? <>Results for &ldquo;{q}&rdquo;</> : 'Search'}
      </h1>
      {products.length === 0 ? (
        <Empty
          title={q ? 'Nothing matched that' : 'What are you looking for?'}
          body={
            q
              ? 'Try a category — frocks, kurta sets, lehenga — or an age. If we have it in the shop but not on the site yet, message us and we will send photos.'
              : 'Search by style, colour or category.'
          }
          cta={{ label: 'Browse everything', href: '/c/all' }}
        />
      ) : (
        <div className="grid grid-cols-2 gap-5 sm:gap-6 lg:grid-cols-4">
          {products.map((p: any) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </div>
  );
}
