import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCart, getShopConfig } from '@/lib/api';
import CartView from '@/components/CartView';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your bag',
  robots: { index: false, follow: false },
};

export default async function CartPage() {
  // Nothing can be in a bag while ordering is closed — don't show an empty one.
  const cfg = await getShopConfig();
  if (!cfg.success || !cfg.data.checkoutEnabled) redirect('/');

  const res = await getCart();
  const cart = res.success
    ? res.data
    : { lines: [], itemCount: 0, subtotal: 0, mrpTotal: 0, savings: 0, holdExpiresAt: null };

  return (
    <div className="shell py-9">
      <CartView initial={cart} />
    </div>
  );
}
