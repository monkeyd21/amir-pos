import type { Metadata } from 'next';
import Link from 'next/link';
import AgeTiles from '@/components/AgeTiles';

export const metadata: Metadata = {
  title: 'Shop by age',
  description:
    'Browse kids ethnic wear by your child’s age — sizes 12 to 36, six months to sixteen years.',
  alternates: { canonical: '/age' },
};

export default function AgePage() {
  return (
    <div className="py-8">
      <div className="shell">
        <h1 className="text-[32px]">Shop by age</h1>
        <p className="mt-3 max-w-[58ch] text-[16px] text-body">
          Sizes here are numbers, not letters — and the number is roughly the chest in
          inches. Pick your child&rsquo;s age and we will show what fits.{' '}
          <Link href="/size-guide" className="underline hover:text-brand">
            The full chart is here
          </Link>
          .
        </p>
      </div>
      <AgeTiles heading={false} />
    </div>
  );
}
