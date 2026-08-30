'use client';

/**
 * The countdown on a held bag.
 *
 * This is the ONLY timer a shopper ever sees, and it only appears once stock is
 * genuinely held for them. It is information about their own bag, not a
 * pressure device: no red, no flashing, no "hurry".
 */
import { useEffect, useState } from 'react';

function remaining(until: string): number {
  return Math.max(0, new Date(until).getTime() - Date.now());
}

export default function HoldTimer({
  expiresAt,
  onExpire,
  label = 'Held in your bag',
}: {
  expiresAt: string | null;
  onExpire?: () => void;
  label?: string;
}) {
  const [ms, setMs] = useState(() => (expiresAt ? remaining(expiresAt) : 0));

  useEffect(() => {
    if (!expiresAt) return;
    setMs(remaining(expiresAt));
    const t = setInterval(() => {
      const left = remaining(expiresAt);
      setMs(left);
      if (left <= 0) {
        clearInterval(t);
        onExpire?.();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [expiresAt, onExpire]);

  if (!expiresAt || ms <= 0) return null;

  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);

  return (
    <div className="flex items-center justify-between border border-rule bg-sand px-4 py-3">
      <span className="flex items-center gap-2.5 text-[13.5px] text-body">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#7c2d4a" strokeWidth="1.4" aria-hidden>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 2" />
        </svg>
        {label}
      </span>
      <span className="tnum text-[17px] font-medium" aria-live="off">
        {mins}:{String(secs).padStart(2, '0')}
      </span>
    </div>
  );
}
