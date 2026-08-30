import { SHOP_IDENTITY, COMMERCE, DELIVERY } from '@clothing-erp/shared';

const items = [
  {
    title: 'Sizes 12 to 36',
    sub: 'Six months to sixteen years',
    icon: <path d="M4 21V9l8-5 8 5v12M9.5 21v-6h5v6" />,
  },
  {
    title: 'Free delivery, every order',
    sub: `Dispatched from ${DELIVERY.originCity} in ${DELIVERY.dispatchDays} days`,
    icon: (
      <>
        <path d="M2 7h11v9H2z" />
        <path d="M13 10h4l3 3v3h-7z" />
        <circle cx="6" cy="18" r="1.8" />
        <circle cx="17" cy="18" r="1.8" />
      </>
    ),
  },
  {
    title: 'Wrong size? Exchange free',
    sub: `${COMMERCE.exchangeWindowDays} days, unworn, tags intact`,
    icon: (
      <>
        <path d="M4 10a8 8 0 0 1 13.6-4.4L20 8" />
        <path d="M20 14a8 8 0 0 1-13.6 4.4L4 16" />
        <path d="M20 4v4h-4M4 20v-4h4" />
      </>
    ),
  },
  {
    title: 'Not sure of the size?',
    sub: "WhatsApp us your child's age",
    icon: <path d="M20 11.5a8 8 0 0 1-11.9 7L4 20l1.6-4A8 8 0 1 1 20 11.5Z" />,
  },
];

export default function TrustStrip() {
  return (
    <section className="border-y border-line">
      <div className="shell grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item, i) => (
          <div
            key={item.title}
            className={`flex items-center gap-3 py-5 sm:px-6 ${
              i < items.length - 1 ? 'lg:border-r lg:border-line' : ''
            } ${i === 0 ? 'lg:pl-0' : ''}`}
          >
            <svg
              width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke="#7c2d4a" strokeWidth="1.3" className="shrink-0" aria-hidden
            >
              {item.icon}
            </svg>
            <div className="flex flex-col">
              <span className="text-[13.5px] font-medium">{item.title}</span>
              <span className="text-[12.5px] text-muted">{item.sub}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
