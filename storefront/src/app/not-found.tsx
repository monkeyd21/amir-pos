import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="shell flex flex-col items-center gap-3 py-24 text-center">
      <h1 className="font-display text-[34px]">We could not find that page</h1>
      <p className="max-w-[44ch] text-[15.5px] text-body">
        It may have been a style that has since sold, or a link that has changed.
      </p>
      <Link
        href="/c/all"
        className="mt-3 border border-ink px-7 py-3 text-[12.5px] uppercase tracking-[0.16em] hover:bg-ink hover:text-white"
      >
        Browse everything
      </Link>
    </div>
  );
}
