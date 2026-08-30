import type { Metadata } from 'next';
import Link from 'next/link';
import { getSizes } from '@/lib/api';
import { SHOP_IDENTITY, COMMERCE } from '@clothing-erp/shared';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Which size for which age',
  description:
    'Kids ethnic wear size chart — sizes 12 to 36 mapped to ages 6 months to 16 years, with chest and length measurements.',
  alternates: { canonical: '/size-guide' },
};

const whatsappHref = `https://wa.me/${SHOP_IDENTITY.whatsappNumber}?text=${encodeURIComponent(
  "Hello! Could you help me pick a size? My child's age is: "
)}`;

export default async function SizeGuidePage() {
  const res = await getSizes();
  // The size master holds two vocabularies: the numeric grid (which needs
  // translating for a parent) and age-named entries like "4-5 Y" (which are
  // already an age). The chart is the translation, so it shows the numeric grid
  // — listing "4-5 Y → 4-5 Y" would be noise.
  const sizes = (res.success ? res.data : []).filter((s: any) => s.ageLabel);

  return (
    <div className="shell py-10">
      <span className="text-[11px] uppercase tracking-[0.24em] text-brand">Help</span>
      <h1 className="mb-4 mt-3 max-w-[18ch] text-[34px] leading-tight sm:text-[40px]">
        Which size for which age
      </h1>
      <p className="mb-9 max-w-[62ch] text-[16.5px] text-body">
        Indian kidswear sizes are numbers, not letters, and the number is roughly the chest
        measurement in inches. Size 24 fits a typical five year old. If your child is between
        two sizes, or on the taller side, take the larger one — ethnic wear is worn a few
        times a year and a little room is better than none.
      </p>
      <p className="mb-9 max-w-[62ch] text-[15px] text-muted">
        Some of our pieces are labelled by age instead — <span className="whitespace-nowrap">6-9 M</span>,{' '}
        <span className="whitespace-nowrap">4-5 Y</span>. Those need no translation: order the
        age you would expect.
      </p>

      <div className="grid gap-12 lg:grid-cols-[1.25fr_1fr]">
        <div>
          <div className="overflow-x-auto border border-rule">
            <table className="w-full border-collapse text-[15px]">
              <caption className="sr-only">Age to size, with garment measurements</caption>
              <thead>
                <tr className="bg-brand text-white">
                  <th scope="col" className="px-4 py-3 text-left text-[12.5px] font-medium uppercase tracking-[0.08em]">Age</th>
                  <th scope="col" className="px-4 py-3 text-left text-[12.5px] font-medium uppercase tracking-[0.08em]">Size</th>
                  <th scope="col" className="px-4 py-3 text-right text-[12.5px] font-medium uppercase tracking-[0.08em]">Chest</th>
                  <th scope="col" className="px-4 py-3 text-right text-[12.5px] font-medium uppercase tracking-[0.08em]">Length</th>
                </tr>
              </thead>
              <tbody>
                {sizes.map((s: any) => (
                  <tr key={s.name} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5">{s.ageLabel ?? '—'}</td>
                    <td className="tnum px-4 py-2.5 font-medium">{s.name}</td>
                    <td className="tnum px-4 py-2.5 text-right text-[#6b625a]">
                      {s.chestInches ? `${s.chestInches} in` : '—'}
                    </td>
                    <td className="tnum px-4 py-2.5 text-right text-[#6b625a]">
                      {s.lengthInches ? `${s.lengthInches} in` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3.5 max-w-[60ch] text-[13px] text-muted">
            Chest and length are garment measurements in inches, taken flat and doubled.
            Lengths vary a little by style — each product page lists its own.
          </p>
        </div>

        <aside className="flex flex-col gap-6">
          <section className="border border-rule p-6">
            <h2 className="mb-3.5 font-display text-[21px]">If you&rsquo;d rather measure</h2>
            <ol className="flex list-decimal flex-col gap-2 pl-5 text-[14.5px] text-body">
              <li>Take a garment that already fits her well and lay it flat.</li>
              <li>Measure straight across the chest, just under the arms, and double it.</li>
              <li>Match that number to the chest column. That is the size.</li>
            </ol>
            <p className="mt-3.5 text-[13.5px] text-muted">
              Measuring a garment is far more reliable than measuring a child who does not
              want to be measured.
            </p>
          </section>

          <section className="border border-line bg-sand p-6">
            <h2 className="mb-3 font-display text-[21px]">Still not sure?</h2>
            <p className="mb-3.5 text-[14.5px] text-body">
              Send us your child&rsquo;s age and height on WhatsApp and we will tell you which
              size to order. We do this all day in the shop.
            </p>
            <a
              href={whatsappHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2.5 border border-ok px-5 py-3 text-[13.5px] text-ok hover:bg-ok hover:text-white"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
                <path d="M20 11.5a8 8 0 0 1-11.9 7L4 20l1.6-4A8 8 0 1 1 20 11.5Z" />
              </svg>
              Ask on WhatsApp
            </a>
          </section>

          <section className="border border-rule p-6">
            <div className="mb-2.5 flex items-center gap-2.5">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7c2d4a" strokeWidth="1.4" aria-hidden>
                <path d="M4 10a8 8 0 0 1 13.6-4.4L20 8" />
                <path d="M20 14a8 8 0 0 1-13.6 4.4L4 16" />
                <path d="M20 4v4h-4M4 20v-4h4" />
              </svg>
              <span className="text-[15.5px] font-medium">Wrong size? Exchange is free</span>
            </div>
            <p className="text-[14px] text-body">
              {COMMERCE.exchangeWindowDays} days from delivery, unworn and with tags on.
            </p>
          </section>

          <Link href="/c/all" className="btn-ghost text-center">
            Back to shopping
          </Link>
        </aside>
      </div>
    </div>
  );
}
