import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SHOP_IDENTITY, COMMERCE, DELIVERY } from '@clothing-erp/shared';

/**
 * The legal and logistics pages every shop needs. Written plainly, because a
 * returns policy nobody can understand is the same as not having one.
 *
 * ASSUMED throughout — these need a read-through by the shop before launch.
 */
const PAGES: Record<string, { title: string; body: string[] }> = {
  delivery: {
    title: 'Delivery',
    body: [
      `We dispatch from ${DELIVERY.originCity} within ${DELIVERY.dispatchDays} working days of your order. Delivery usually takes a further ${DELIVERY.deliveryDaysMin} to ${DELIVERY.deliveryDaysMax} days depending on where you are.`,
      'Delivery is free on every order, with no minimum.',
      'We send the tracking link on WhatsApp as soon as the parcel leaves us. If it has not arrived when you expected it, message us and we will chase the courier.',
      'We currently deliver across India. We do not ship outside India yet.',
    ],
  },
  exchanges: {
    title: 'Exchanges and returns',
    body: [
      `If the size is wrong, we will exchange it free within ${COMMERCE.exchangeWindowDays} days of delivery. The garment must be unworn, unwashed and have its tags on.`,
      'Children grow between the order and the occasion — we would rather swap a size than have something sit unworn, so just message us on WhatsApp with your order number and the size you need instead.',
      'For a refund rather than an exchange, tell us within the same window and we will arrange it once the piece is back with us and checked.',
      'Pieces marked as clearance can be exchanged but not refunded, and that is stated on the product page before you buy.',
    ],
  },
  refunds: {
    title: 'Refunds',
    body: [
      'Refunds go back to the account you paid from, usually within 5 to 7 working days of us receiving and checking the returned piece.',
      'If an item sells in the shop while your online payment is going through, the order is cancelled automatically and the full amount is returned. You are never charged for something we cannot send.',
      'If you think a refund is late, message us with the order number and we will find it.',
    ],
  },
  privacy: {
    title: 'Privacy',
    body: [
      'We collect only what we need to send you an order: your name, phone number and delivery address. We use your phone number to sign you in and to send order updates on WhatsApp.',
      'We do not sell your details to anyone, and we do not send marketing messages unless you ask us to.',
      'Payments are handled by our payment provider. We never see or store your card or UPI details.',
      'If you want your details removed from our records, message us and we will do it.',
    ],
  },
  terms: {
    title: 'Terms',
    body: [
      `${SHOP_IDENTITY.name} sells children's ethnic wear from ${SHOP_IDENTITY.addressLine}.`,
      'Prices shown include all taxes. Our website and our shop share one stock room, so on rare occasions something can sell over the counter while you are checking out. If that happens, we cancel the order and refund you in full — we will never take payment for something we cannot send.',
      'Photographs are taken as accurately as we can manage, but colours can vary a little between screens and daylight.',
      'These terms are governed by Indian law.',
    ],
  },
  contact: {
    title: 'Contact us',
    body: [
      `The quickest way to reach us is WhatsApp: +${SHOP_IDENTITY.whatsappNumber}. We answer during shop hours.`,
      `You can also come and see us: ${SHOP_IDENTITY.addressLine}. ${SHOP_IDENTITY.openingHours}.`,
      'If you are unsure about a size, send us your child’s age and height and we will tell you what to order.',
    ],
  },
};

export function generateStaticParams() {
  return Object.keys(PAGES).map((slug) => ({ slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const page = PAGES[params.slug];
  if (!page) return { title: 'Not found' };
  return { title: page.title, alternates: { canonical: `/policies/${params.slug}` } };
}

export default function PolicyPage({ params }: { params: { slug: string } }) {
  const page = PAGES[params.slug];
  if (!page) notFound();

  return (
    <article className="shell max-w-[68ch] py-12">
      <h1 className="mb-6 text-[34px]">{page.title}</h1>
      <div className="flex flex-col gap-4">
        {page.body.map((p, i) => (
          <p key={i} className="text-[16px] leading-relaxed text-body">
            {p}
          </p>
        ))}
      </div>
    </article>
  );
}
