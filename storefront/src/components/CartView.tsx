'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import HoldTimer from './HoldTimer';
import { rupees, sizeWithAge } from '@/lib/format';

interface Line {
  id: number;
  variantId: number;
  productName: string;
  productSlug: string;
  image: string | null;
  size: string;
  ageLabel: string | null;
  quantity: number;
  unitPrice: number;
  mrp: number;
  lineTotal: number;
  availableToAdd: number;
  holdExpiresAt: string | null;
}

interface Cart {
  lines: Line[];
  itemCount: number;
  subtotal: number;
  mrpTotal: number;
  savings: number;
  holdExpiresAt: string | null;
}

export default function CartView({ initial }: { initial: Cart }) {
  const router = useRouter();
  const [cart, setCart] = useState<Cart>(initial);
  const [busy, setBusy] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/shop/cart');
    const body = await res.json();
    if (body.success) setCart(body.data);
    window.dispatchEvent(new Event('cart:changed'));
  }, []);

  /**
   * When the holds lapse, the stock behind this bag may already have gone to
   * someone at the counter. Re-check rather than let the shopper walk into a
   * failure at payment.
   */
  const onHoldExpired = useCallback(async () => {
    const res = await fetch('/api/shop/cart/revalidate', { method: 'POST' });
    const body = await res.json();
    if (body.success) {
      setCart(body.data.cart);
      if (body.data.problems.length > 0) {
        const p = body.data.problems[0];
        setNotice(
          p.available === 0
            ? `${p.productName} in size ${p.size} sold while your bag was open. We have removed it.`
            : `Only ${p.available} left of ${p.productName} in size ${p.size}.`
        );
      }
    }
  }, []);

  async function mutate(url: string, init: RequestInit, lineId: number) {
    setBusy(lineId);
    setNotice(null);
    try {
      const res = await fetch(url, init);
      const body = await res.json();
      if (!body.success) {
        setNotice(body.error || 'That change could not be made.');
        await refresh();
        return;
      }
      setCart(body.data);
      window.dispatchEvent(new Event('cart:changed'));
    } finally {
      setBusy(null);
    }
  }

  const setQty = (line: Line, qty: number) =>
    mutate(
      `/api/shop/cart/items/${line.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: qty }),
      },
      line.id
    );

  const remove = (line: Line) =>
    mutate(`/api/shop/cart/items/${line.id}`, { method: 'DELETE' }, line.id);

  if (cart.lines.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-center">
        <h1 className="font-display text-2xl">Your bag is empty</h1>
        <p className="max-w-[42ch] text-[15px] text-body">
          Nothing in here yet. Have a look at what came in this week.
        </p>
        <Link
          href="/c/all"
          className="mt-3 border border-ink px-7 py-3 text-[12.5px] uppercase tracking-[0.16em] hover:bg-ink hover:text-white"
        >
          Start shopping
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[1.5fr_1fr]">
      <div className="flex flex-col gap-5">
        <h1 className="text-[30px]">Your bag</h1>

        {cart.holdExpiresAt && (
          <HoldTimer
            expiresAt={cart.holdExpiresAt}
            onExpire={onHoldExpired}
            label="We are holding these for you"
          />
        )}

        {notice && (
          <p role="alert" className="border border-brand bg-[#fdf2f5] px-4 py-3 text-[14px] text-brand">
            {notice}
          </p>
        )}

        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {cart.lines.map((line) => (
            <li key={line.id} className="flex gap-4 py-5">
              <Link href={`/p/${line.productSlug}`} className="w-[84px] shrink-0 sm:w-[100px]">
                <div className="aspect-[4/5] bg-shell">
                  {line.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={line.image} alt={line.productName} className="h-full w-full object-cover" />
                  )}
                </div>
              </Link>

              <div className="flex flex-1 flex-col gap-1.5">
                <Link href={`/p/${line.productSlug}`} className="text-[15px] hover:text-brand">
                  {line.productName}
                </Link>
                <span className="text-[13px] text-muted">
                  Size {sizeWithAge(line.size, line.ageLabel)}
                </span>

                <div className="mt-1.5 flex items-center gap-3">
                  <div className="flex items-center border border-rule">
                    <button
                      type="button"
                      aria-label="Reduce quantity"
                      className="px-3 py-1.5 text-[16px] disabled:opacity-30"
                      disabled={busy === line.id}
                      onClick={() => setQty(line, line.quantity - 1)}
                    >
                      −
                    </button>
                    <span className="tnum min-w-[2rem] text-center text-[14px]">{line.quantity}</span>
                    <button
                      type="button"
                      aria-label="Increase quantity"
                      className="px-3 py-1.5 text-[16px] disabled:opacity-30"
                      disabled={busy === line.id || line.availableToAdd < 1}
                      onClick={() => setQty(line, line.quantity + 1)}
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    className="text-[13px] text-muted underline hover:text-brand"
                    disabled={busy === line.id}
                    onClick={() => remove(line)}
                  >
                    Remove
                  </button>
                </div>
              </div>

              <div className="flex flex-col items-end gap-1">
                <span className="tnum text-[15px] font-medium">{rupees(line.lineTotal)}</span>
                {line.mrp > line.unitPrice && (
                  <span className="tnum text-[13px] text-[#a49a90] line-through">
                    {rupees(line.mrp * line.quantity)}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>

        <Link href="/c/all" className="text-[14px] underline hover:text-brand">
          Keep shopping
        </Link>
      </div>

      <aside className="h-fit border border-rule p-6 lg:sticky lg:top-6">
        <h2 className="mb-4 font-display text-[21px]">Summary</h2>
        <dl className="flex flex-col gap-2.5 text-[14.5px]">
          <Row label={`Bag (${cart.itemCount} ${cart.itemCount === 1 ? 'item' : 'items'})`} value={rupees(cart.mrpTotal)} />
          {cart.savings > 0 && (
            <Row label="Savings" value={`− ${rupees(cart.savings)}`} accent />
          )}
          <Row label="Delivery" value="Free" accent />
        </dl>
        <div className="mt-4 flex items-baseline justify-between border-t border-line pt-4">
          <span className="text-[16px] font-medium">Subtotal</span>
          <span className="tnum text-[20px] font-medium">{rupees(cart.subtotal)}</span>
        </div>
        <p className="mt-1.5 text-[12.5px] text-muted">
          Inclusive of all taxes. Any prepaid discount is applied at checkout.
        </p>

        <button
          type="button"
          className="btn-primary mt-5"
          onClick={() => router.push('/checkout')}
        >
          Checkout
        </button>
      </aside>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className="text-body">{label}</dt>
      <dd className={`tnum ${accent ? 'text-ok' : ''}`}>{value}</dd>
    </div>
  );
}
