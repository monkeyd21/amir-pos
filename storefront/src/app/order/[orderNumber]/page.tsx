import type { Metadata } from 'next';
import Link from 'next/link';
import { getOrder } from '@/lib/api';
import { rupees, sizeWithAge } from '@/lib/format';
import { SHOP_IDENTITY, DELIVERY, COMMERCE } from '@clothing-erp/shared';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your order',
  robots: { index: false, follow: false },
};

const STATUS_COPY: Record<string, { title: string; body: string }> = {
  paid: {
    title: 'Order confirmed',
    body: `We are packing it now. It leaves ${DELIVERY.originCity} within ${DELIVERY.dispatchDays} working days and we will send the tracking link on WhatsApp.`,
  },
  packed: {
    title: 'Packed and ready',
    body: 'Your parcel is packed and waiting for the courier.',
  },
  shipped: {
    title: 'On its way',
    body: 'Your parcel has left the shop. The tracking link below shows where it is.',
  },
  delivered: { title: 'Delivered', body: 'We hope it fits beautifully.' },
  pending_payment: {
    title: 'Waiting for payment',
    body: 'We have not received the payment yet. Nothing has been charged.',
  },
  failed: {
    title: 'Payment did not complete',
    body: 'Nothing has been charged. If any amount left your account it will come back within a few working days.',
  },
  cancelled: { title: 'Order cancelled', body: 'This order was cancelled.' },
  refunded: {
    title: 'Refunded',
    body: 'We could not fulfil this order, so it has been refunded.',
  },
};

export default async function OrderPage({ params }: { params: { orderNumber: string } }) {
  const res = await getOrder(params.orderNumber);

  if (!res.success) {
    return (
      <div className="shell flex flex-col items-center gap-3 py-20 text-center">
        <h1 className="font-display text-2xl">We could not find that order</h1>
        <p className="text-[15px] text-body">
          Please sign in with the number you ordered with.
        </p>
        <Link href="/account" className="mt-3 border border-ink px-7 py-3 text-[12.5px] uppercase tracking-[0.16em] hover:bg-ink hover:text-white">
          Go to your account
        </Link>
      </div>
    );
  }

  const order = res.data;
  const copy = STATUS_COPY[order.status] ?? STATUS_COPY.paid;
  const shipment = order.shipments?.[0];
  const settled = ['paid', 'packed', 'shipped', 'delivered'].includes(order.status);

  return (
    <div className="shell max-w-[860px] py-11">
      <div className="flex flex-col items-center gap-3 text-center">
        {settled && (
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#1f7a5c" strokeWidth="1.3" aria-hidden>
            <circle cx="12" cy="12" r="10" />
            <path d="M7.8 12.4 10.7 15.3 16.4 9.2" />
          </svg>
        )}
        <h1 className="text-[32px]">{copy.title}</h1>
        <p className="max-w-[52ch] text-[15.5px] text-body">{copy.body}</p>
        <p className="tnum mt-1 text-[14px] text-muted">Order {order.orderNumber}</p>
      </div>

      {shipment?.trackingUrl && (
        <a
          href={shipment.trackingUrl}
          target="_blank"
          rel="noreferrer"
          className="mx-auto mt-7 block max-w-sm border border-ink px-6 py-3.5 text-center text-[13px] uppercase tracking-[0.14em] hover:bg-ink hover:text-white"
        >
          Track your parcel
          {shipment.awb && <span className="ml-2 normal-case tracking-normal text-muted">({shipment.awb})</span>}
        </a>
      )}

      <section className="mt-10 border border-line">
        <h2 className="border-b border-line px-6 py-4 text-[12.5px] uppercase tracking-[0.12em] text-muted">
          What you ordered
        </h2>
        <ul className="divide-y divide-line">
          {order.items.map((i: any) => (
            <li key={i.id} className="flex justify-between gap-4 px-6 py-4 text-[14.5px]">
              <span>
                {i.productName}
                <span className="ml-2 text-muted">
                  Size {sizeWithAge(i.sizeName, null)} × {i.quantity}
                </span>
              </span>
              <span className="tnum shrink-0">{rupees(i.total)}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-between border-t border-line px-6 py-4">
          <span className="text-[15px] font-medium">Total</span>
          <span className="tnum text-[17px] font-medium">{rupees(order.total)}</span>
        </div>
      </section>

      <section className="mt-6 grid gap-6 sm:grid-cols-2">
        <div className="border border-line p-6">
          <h2 className="mb-3 text-[12.5px] uppercase tracking-[0.12em] text-muted">Delivering to</h2>
          <p className="text-[14.5px] leading-relaxed">
            <strong className="font-medium">{order.shipName}</strong>
            <br />
            {order.shipLine1}{order.shipLine2 ? `, ${order.shipLine2}` : ''}
            <br />
            {order.shipCity}, {order.shipState} {order.shipPincode}
            <br />
            {order.shipPhone}
          </p>
        </div>
        <div className="border border-line p-6">
          <h2 className="mb-3 text-[12.5px] uppercase tracking-[0.12em] text-muted">Wrong size?</h2>
          <p className="text-[14.5px] leading-relaxed text-body">
            Exchange free within {COMMERCE.exchangeWindowDays} days, unworn with tags on.
            Message us on WhatsApp and we will sort it out.
          </p>
          <a
            href={`https://wa.me/${SHOP_IDENTITY.whatsappNumber}?text=${encodeURIComponent(
              `Hello, about order ${order.orderNumber}: `
            )}`}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-block text-[14px] underline hover:text-brand"
          >
            Message the shop
          </a>
        </div>
      </section>

      <div className="mt-9 text-center">
        <Link href="/c/all" className="text-[14px] underline hover:text-brand">
          Keep shopping
        </Link>
      </div>
    </div>
  );
}
