import Link from 'next/link';
import { rupees, percentOff } from '@/lib/format';

export interface ProductCardData {
  id: number;
  name: string;
  slug: string;
  image: { url: string; alt: string | null } | null;
  priceFrom: number;
  mrpFrom: number;
  inStock: boolean;
  availableSizes: { size: string; ageLabel: string | null }[];
  sizeRange: string[];
}

/**
 * The listing card. Price, MRP struck through, and the size range — exactly the
 * anatomy of the reference site, with one substitution: where it puts a red
 * SALE badge we put nothing, and where it says nothing about sizes we say which
 * ones a parent can actually buy.
 */
export default function ProductCard({ product }: { product: ProductCardData }) {
  const off = percentOff(product.mrpFrom, product.priceFrom);
  const sizes = product.sizeRange;
  const range =
    sizes.length > 1 ? `Sizes ${sizes[0]} – ${sizes[sizes.length - 1]}` : sizes.length === 1 ? `Size ${sizes[0]}` : '';

  return (
    <Link href={`/p/${product.slug}`} className="group flex flex-col gap-3">
      <div className="relative aspect-[4/5] overflow-hidden bg-shell">
        {product.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.image.url}
            alt={product.image.alt || product.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <span className="flex h-full items-center justify-center text-[10px] uppercase tracking-[0.18em] text-[#bbaa9c]">
            Photograph
          </span>
        )}
        {!product.inStock && (
          <span className="absolute inset-0 flex items-center justify-center bg-white/75 text-[12px] uppercase tracking-[0.16em] text-[#6b625a]">
            Out of stock
          </span>
        )}
      </div>

      <h3 className="min-h-[40px] font-sans text-[14px] leading-snug group-hover:text-brand">
        {product.name}
      </h3>

      <div className="flex flex-wrap items-baseline gap-2">
        <span className="tnum text-base font-medium">{rupees(product.priceFrom)}</span>
        {off > 0 && (
          <>
            <span className="tnum text-[13px] text-[#a49a90] line-through">{rupees(product.mrpFrom)}</span>
            <span className="text-[12px] text-brand">{off}% off</span>
          </>
        )}
      </div>

      {range && <p className="text-[12.5px] text-muted">{range}</p>}
    </Link>
  );
}
