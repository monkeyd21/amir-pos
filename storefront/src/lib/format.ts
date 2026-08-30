/** Indian rupee formatting — lakh/crore grouping, no decimals on whole amounts. */
export function rupees(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return `₹${n.toLocaleString('en-IN', {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/** "24 · 5 years" — a size number never appears without its age. */
export function sizeWithAge(size: string, ageLabel?: string | null): string {
  return ageLabel ? `${size} · ${ageLabel}` : size;
}

export function percentOff(mrp: number, price: number): number {
  if (!mrp || mrp <= price) return 0;
  return Math.round(((mrp - price) / mrp) * 100);
}
