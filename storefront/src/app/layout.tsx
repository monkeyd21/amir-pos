import type { Metadata } from 'next';
import { Prata, Jost } from 'next/font/google';
import './globals.css';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { SITE_URL } from '@/lib/config';
import { SHOP_IDENTITY } from '@clothing-erp/shared';

const display = Prata({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

const body = Jost({
  weight: ['300', '400', '500', '600'],
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SHOP_IDENTITY.name} — Kids ethnic wear`,
    template: `%s · ${SHOP_IDENTITY.name}`,
  },
  description:
    'Frocks, lehenga cholis, kurta sets and sherwanis for children. Sizes 12 to 36, six months to sixteen years. Dispatched from Nagpur.',
  openGraph: {
    type: 'website',
    siteName: SHOP_IDENTITY.name,
    locale: 'en_IN',
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${display.variable} ${body.variable}`}>
      <body className="flex min-h-screen flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-ink focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to content
        </a>
        <Header />
        <main id="main" className="flex-1">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
