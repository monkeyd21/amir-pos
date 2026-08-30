import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getCart, getShopConfig } from '@/lib/api';
import Checkout from '@/components/Checkout';
import { COOKIE } from '@/lib/config';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false, follow: false },
};

export default async function CheckoutPage() {
  const cfg = await getShopConfig();
  if (!cfg.success || !cfg.data.checkoutEnabled) redirect('/');

  const cart = await getCart();
  if (!cart.success || cart.data.lines.length === 0) redirect('/cart');

  const signedIn = Boolean(cookies().get(COOKIE.access)?.value);

  return (
    <div className="shell py-9">
      <Checkout signedIn={signedIn} />
    </div>
  );
}
