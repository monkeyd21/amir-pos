'use client';

/**
 * Size selection, stock, hold countdown and add-to-bag.
 *
 * The interactive half of the product page. Everything above it is server
 * rendered so Google sees the product; this part needs state.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import SizePicker, { SizeOption } from './SizePicker';
import { rupees, percentOff, sizeWithAge } from '@/lib/format';
import { SHOP_IDENTITY, DELIVERY } from '@clothing-erp/shared';

interface Props {
  productName: string;
  variants: SizeOption[];
  codBlocked: boolean;
  /** False while the shop is browse-only — see shop-config `checkoutEnabled`. */
  checkoutEnabled: boolean;
}

export default function BuyPanel({ productName, variants, codBlocked, checkoutEnabled }: Props) {
  const router = useRouter();
  const firstInStock = useMemo(() => variants.find((v) => v.inStock) ?? null, [variants]);
  const [selectedId, setSelectedId] = useState<number | null>(firstInStock?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  const selected = variants.find((v) => v.id === selectedId) ?? null;
  const anyInStock = variants.some((v) => v.inStock);

  // With a size chosen, the message carries it — so the shop can answer in one
  // reply instead of asking which one.
  const enquiry = selected
    ? `Hello! I'd like the "${productName}" in size ${selected.size}${
        selected.ageLabel ? ` (${selected.ageLabel})` : ''
      }. Is it available?`
    : `Hello! I'm looking at "${productName}" on your website. Could you help me pick the right size?`;
  const whatsappHref = `https://wa.me/${SHOP_IDENTITY.whatsappNumber}?text=${encodeURIComponent(enquiry)}`;

  async function addToBag(goToCheckout = false) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/shop/cart/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variantId: selected.id, quantity: 1 }),
      });
      const body = await res.json();
      if (!body.success) {
        // A 409 here means the piece went while the shopper was deciding —
        // say so plainly and refresh the page's stock.
        setError(body.error || 'That size has just gone. Please pick another.');
        router.refresh();
        return;
      }
      setAdded(true);
      window.dispatchEvent(new Event('cart:changed'));
      if (goToCheckout) router.push('/cart');
    } catch {
      setError('We could not reach the shop. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {selected && (
        <div className="flex items-center gap-2.5">
          {selected.inStock ? (
            <>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#1f7a5c" strokeWidth="1.6" aria-hidden>
                <circle cx="12" cy="12" r="9" />
                <path d="M8.4 12.2 11 14.8 15.8 9.6" />
              </svg>
              <span className="text-[14px] text-ok">
                In stock — dispatched from {DELIVERY.originCity} within {DELIVERY.dispatchDays} days
              </span>
            </>
          ) : (
            <span className="text-[14px] text-muted">This size is sold out just now</span>
          )}
        </div>
      )}

      <SizePicker variants={variants} selectedId={selectedId} onSelect={setSelectedId} />

      {/* Measurements for the chosen size — the second half of the size answer */}
      {selected && (selected.chestInches || selected.lengthInches) && (
        <div className="border border-line bg-sand px-4 py-4">
          <div className="mb-2.5 text-[12.5px] uppercase tracking-[0.1em] text-muted">
            Size {sizeWithAge(selected.size, selected.ageLabel)} measurements
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {selected.chestInches != null && (
              <Measure value={`${selected.chestInches} in`} label="Chest" />
            )}
            {selected.lengthInches != null && (
              <Measure value={`${selected.lengthInches} in`} label="Length" />
            )}
          </div>
          <p className="mt-2.5 text-[12.5px] text-muted">
            Between sizes? Take the larger one — ethnic wear is worn a few times a year and a
            little room is better than none.
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="border border-brand bg-[#fdf2f5] px-4 py-3 text-[14px] text-brand">
          {error}
        </p>
      )}

      {checkoutEnabled ? (
        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            className="btn-primary"
            disabled={!selected || !selected.inStock || busy}
            onClick={() => addToBag(false)}
          >
            {busy ? 'Adding…' : added ? 'Added — add another?' : anyInStock ? 'Add to bag' : 'Sold out'}
          </button>
          <button
            type="button"
            className="btn-brand"
            disabled={!selected || !selected.inStock || busy}
            onClick={() => addToBag(true)}
          >
            Buy it now
          </button>
          <a href={whatsappHref} target="_blank" rel="noreferrer" className="btn-ghost flex items-center justify-center gap-2.5">
            <WhatsAppIcon />
            Tell us your child&rsquo;s age and we&rsquo;ll pick the size
          </a>
        </div>
      ) : (
        /* Browse-only. Rather than a dead button, send the shopper somewhere
           that actually works — the shop answers WhatsApp all day. */
        <div className="flex flex-col gap-3">
          <a
            href={whatsappHref}
            target="_blank"
            rel="noreferrer"
            className="btn-brand flex items-center justify-center gap-2.5 no-underline"
          >
            <WhatsAppIcon light />
            {selected?.inStock ? 'Reserve this on WhatsApp' : 'Ask about this on WhatsApp'}
          </a>
          <p className="text-center text-[13px] text-muted">
            Online payment is opening soon. For now we take orders on WhatsApp and
            put the piece aside for you.
          </p>
        </div>
      )}

      {added && checkoutEnabled && (
        <a href="/cart" className="text-center text-[14px] underline hover:text-brand">
          Go to your bag
        </a>
      )}

      {codBlocked && (
        <p className="text-[12.5px] text-muted">This item is prepaid only.</p>
      )}
    </div>
  );
}

function WhatsAppIcon({ light }: { light?: boolean }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
         stroke={light ? 'currentColor' : '#1f7a5c'} strokeWidth="1.4" aria-hidden>
      <path d="M20 11.5a8 8 0 0 1-11.9 7L4 20l1.6-4A8 8 0 1 1 20 11.5Z" />
    </svg>
  );
}

function Measure({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col">
      <span className="tnum text-[15px]">{value}</span>
      <span className="text-[12px] text-muted">{label}</span>
    </div>
  );
}
