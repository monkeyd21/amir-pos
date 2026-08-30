'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

/** Bag icon with a live count. Refreshes when the tab regains focus. */
export default function CartBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/shop/cart');
        const body = await res.json();
        if (!cancelled && body?.success) setCount(body.data.itemCount ?? 0);
      } catch {
        /* the badge is decoration; never break the header over it */
      }
    };
    load();
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    window.addEventListener('cart:changed', onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('cart:changed', onFocus);
    };
  }, []);

  return (
    <Link href="/cart" className="relative flex items-center gap-1.5 text-[14px] hover:text-brand">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
        <path d="M6 8h12l1 12H5L6 8Z" />
        <path d="M9 8V6a3 3 0 0 1 6 0v2" />
      </svg>
      <span className="hidden sm:inline">Bag</span>
      {count > 0 && (
        <span className="tnum absolute -right-2 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-brand text-[9px] text-white sm:static sm:ml-0.5 sm:h-auto sm:w-auto sm:rounded-none sm:bg-transparent sm:text-[14px] sm:text-inherit">
          <span className="sm:hidden">{count}</span>
          <span className="hidden sm:inline">({count})</span>
        </span>
      )}
    </Link>
  );
}
