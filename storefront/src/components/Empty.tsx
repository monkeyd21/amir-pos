import Link from 'next/link';

/**
 * The state a new shop is in most of the time before the photography is done.
 * Says what is true rather than showing a blank grid.
 */
export default function Empty({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta?: { label: string; href: string };
}) {
  return (
    <div className="shell flex flex-col items-center gap-3 py-20 text-center">
      <h2 className="font-display text-2xl">{title}</h2>
      <p className="max-w-[46ch] text-[15px] text-body">{body}</p>
      {cta && (
        <Link
          href={cta.href}
          className="mt-3 border border-ink px-7 py-3 text-[12.5px] uppercase tracking-[0.16em] hover:bg-ink hover:text-white"
        >
          {cta.label}
        </Link>
      )}
    </div>
  );
}
