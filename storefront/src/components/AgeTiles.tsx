import Link from 'next/link';
import { AGE_BANDS } from '@clothing-erp/shared';

/**
 * Shop by age — the primary browse axis for kidswear.
 *
 * A parent arrives knowing their child is four, not that they need a 22. This
 * is the same mapping as the size chart, made clickable.
 */
export default function AgeTiles({ heading = true }: { heading?: boolean }) {
  return (
    <section className="shell py-9">
      {heading && (
        <div className="mb-5 flex items-baseline justify-between">
          <h2 className="font-display text-2xl">Shop by age</h2>
          <Link href="/size-guide" className="border-b border-rule pb-0.5 text-[13px] uppercase tracking-[0.08em] hover:border-ink">
            Full size chart
          </Link>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
        {AGE_BANDS.map((band) => (
          <Link
            key={band.slug}
            href={`/c/all?age=${band.slug}`}
            className="flex flex-col items-center gap-1 border border-rule px-2.5 py-4 transition-colors hover:border-ink"
          >
            <span className="text-[15px]">{band.label}</span>
            <span className="tnum text-[11.5px] text-muted">
              {band.sizes.length > 1
                ? `Sizes ${band.sizes[0]}–${band.sizes[band.sizes.length - 1]}`
                : `Size ${band.sizes[0]}`}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
