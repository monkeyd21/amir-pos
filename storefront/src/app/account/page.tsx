import type { Metadata } from 'next';
import Link from 'next/link';
import { getMe, listOrders } from '@/lib/api';
import { rupees } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your account',
  robots: { index: false, follow: false },
};

const LABEL: Record<string, string> = {
  pending_payment: 'Awaiting payment',
  paid: 'Confirmed',
  packed: 'Packed',
  shipped: 'On its way',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  failed: 'Payment failed',
  refunded: 'Refunded',
};

export default async function AccountPage() {
  const me = await getMe();

  if (!me.success || !me.data) {
    return (
      <div className="shell flex flex-col items-center gap-3 py-20 text-center">
        <h1 className="font-display text-2xl">Sign in to see your orders</h1>
        <p className="max-w-[44ch] text-[15px] text-body">
          We sign you in with a code on WhatsApp — there is no password to remember. Add
          something to your bag and you will be asked at checkout.
        </p>
        <Link href="/c/all" className="mt-3 border border-ink px-7 py-3 text-[12.5px] uppercase tracking-[0.16em] hover:bg-ink hover:text-white">
          Start shopping
        </Link>
      </div>
    );
  }

  const orders = await listOrders();
  const list = orders.success ? orders.data : [];

  return (
    <div className="shell max-w-[900px] py-10">
      <h1 className="text-[30px]">Hello, {me.data.firstName}</h1>
      <p className="mt-2 text-[14.5px] text-muted">
        {me.data.phone}
        {me.data.loyaltyPoints > 0 && (
          <> · {me.data.loyaltyPoints} loyalty points ({me.data.loyaltyTier})</>
        )}
      </p>

      <h2 className="mb-4 mt-9 font-display text-[22px]">Your orders</h2>

      {list.length === 0 ? (
        <p className="border border-line p-6 text-[15px] text-body">
          No orders yet. <Link href="/c/all" className="underline">Have a look at what is new.</Link>
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {list.map((o: any) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div className="flex flex-col">
                <Link href={`/order/${o.orderNumber}`} className="tnum text-[15px] hover:text-brand">
                  {o.orderNumber}
                </Link>
                <span className="text-[13px] text-muted">
                  {new Date(o.placedAt).toLocaleDateString('en-IN', {
                    day: 'numeric', month: 'long', year: 'numeric',
                  })}
                  {' · '}
                  {o.items.length} {o.items.length === 1 ? 'item' : 'items'}
                </span>
              </div>
              <div className="flex items-center gap-5">
                <span className="text-[13px] text-muted">{LABEL[o.status] ?? o.status}</span>
                <span className="tnum text-[15px] font-medium">{rupees(o.total)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
