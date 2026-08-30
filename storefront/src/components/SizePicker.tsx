'use client';

/**
 * The size selector, and the one component that carries the whole product idea.
 *
 * Indian kidswear sizes are numbers — 12 to 36 — and "22" tells a parent
 * nothing. That is precisely why the shop hands out a printed chart. So every
 * chip shows BOTH, always:
 *
 *        22
 *      4 years
 *
 * A sold-out size stays visible, struck through, rather than vanishing: a
 * parent who cannot get a 26 will often take a 28, and hiding it just makes the
 * range look wrong.
 */
import { sizeWithAge } from '@/lib/format';

export interface SizeOption {
  id: number;
  size: string;
  ageLabel: string | null;
  inStock: boolean;
  available: number;
  chestInches: number | null;
  lengthInches: number | null;
}

export default function SizePicker({
  variants,
  selectedId,
  onSelect,
}: {
  variants: SizeOption[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const soldOut = variants.filter((v) => !v.inStock);
  const first = variants[0];
  const last = variants[variants.length - 1];

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[12.5px] uppercase tracking-[0.1em] text-muted">Size</span>
        <a href="/size-guide" className="flex items-center gap-1.5 border-b border-rule pb-0.5 text-[13px] hover:border-ink">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
            <path d="M3 8h18v8H3z" />
            <path d="M7 8v3M11 8v4M15 8v3M19 8v4" />
          </svg>
          Size chart
        </a>
      </div>

      {first && last && (
        <p className="mb-3 text-[13px] text-muted">
          Made in sizes {first.size} to {last.size}
          {first.ageLabel && last.ageLabel ? ` — ${first.ageLabel} to ${last.ageLabel}.` : '.'}
        </p>
      )}

      <div role="radiogroup" aria-label="Choose a size" className="grid grid-cols-4 gap-2">
        {variants.map((v) => {
          const selected = v.id === selectedId;
          return (
            <button
              key={v.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`Size ${sizeWithAge(v.size, v.ageLabel)}${v.inStock ? '' : ' — sold out'}`}
              disabled={!v.inStock}
              onClick={() => onSelect(v.id)}
              className={[
                'flex min-h-[56px] flex-col items-center justify-center gap-0.5 border px-1.5 py-2.5 transition-colors',
                selected
                  ? 'border-ink bg-ink text-white'
                  : v.inStock
                    ? 'border-rule hover:border-ink'
                    : 'cursor-not-allowed border-line text-[#c4bbb1]',
              ].join(' ')}
            >
              <span className={`tnum text-base ${!v.inStock ? 'line-through' : ''}`}>{v.size}</span>
              <span className={`text-[11.5px] ${selected ? 'opacity-75' : v.inStock ? 'text-muted' : ''}`}>
                {v.ageLabel ?? ' '}
              </span>
            </button>
          );
        })}
      </div>

      {soldOut.length > 0 && (
        <p className="mt-2.5 text-[12.5px] text-muted">
          {soldOut.length === 1
            ? `Size ${soldOut[0].size} is sold out just now.`
            : `Sizes ${soldOut.map((s) => s.size).join(', ')} are sold out just now.`}{' '}
          Message us and we will tell you when it is back.
        </p>
      )}
    </div>
  );
}
