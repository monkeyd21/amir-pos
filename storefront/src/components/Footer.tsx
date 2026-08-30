import Link from 'next/link';
import { SHOP_IDENTITY } from '@clothing-erp/shared';

const whatsappHref = `https://wa.me/${SHOP_IDENTITY.whatsappNumber}`;

export default function Footer() {
  return (
    <footer className="mt-16 bg-ink text-[#d9d1c8]">
      <div className="shell py-11">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-3">
            <span className="font-display text-xl text-white">{SHOP_IDENTITY.name}</span>
            <p className="max-w-[34ch] text-[13.5px] leading-relaxed">
              {SHOP_IDENTITY.addressLine}
              <br />
              {SHOP_IDENTITY.openingHours}
            </p>
            <a href={whatsappHref} className="flex items-center gap-2 text-[13.5px] hover:text-white">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
                <path d="M20 11.5a8 8 0 0 1-11.9 7L4 20l1.6-4A8 8 0 1 1 20 11.5Z" />
              </svg>
              Message us on WhatsApp
            </a>
          </div>

          <FooterColumn
            title="Shop"
            links={[
              ['New in', '/c/new-in'],
              ['Girls', '/c/girls'],
              ['Boys', '/c/boys'],
              ['Festive', '/c/festive'],
            ]}
          />
          <FooterColumn
            title="Help"
            links={[
              ['Size guide', '/size-guide'],
              ['Delivery', '/policies/delivery'],
              ['Exchanges', '/policies/exchanges'],
              ['Track an order', '/account/orders'],
            ]}
          />

          <div className="flex flex-col gap-3">
            <span className="text-[11px] uppercase tracking-[0.16em] text-muted">
              Where every size fits an age
            </span>
            <p className="text-[13.5px] leading-relaxed">
              Sizes run 12 to 36, for six months to sixteen years. Not sure which?
              <Link href="/size-guide" className="ml-1 underline hover:text-white">
                Check the chart
              </Link>
              .
            </p>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-2 border-t border-[#35302b] pt-5 text-[12.5px] text-muted sm:flex-row sm:justify-between">
          <span>© {new Date().getFullYear()} {SHOP_IDENTITY.name}</span>
          <span className="flex gap-4">
            <Link href="/policies/privacy" className="hover:text-white">Privacy</Link>
            <Link href="/policies/refunds" className="hover:text-white">Refunds</Link>
            <Link href="/policies/terms" className="hover:text-white">Terms</Link>
          </span>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div className="flex flex-col gap-2.5 text-[13.5px]">
      <span className="mb-1 text-[11px] uppercase tracking-[0.16em] text-muted">{title}</span>
      {links.map(([label, href]) => (
        <Link key={href} href={href} className="hover:text-white">
          {label}
        </Link>
      ))}
    </div>
  );
}
