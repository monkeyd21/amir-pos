import { canExchangeLine } from '@clothing-erp/shared';

/**
 * Builds the list of lines the POS exchange panel offers the cashier.
 *
 * Pulled out of `pos-terminal.component.ts` on purpose: which lines a bill may
 * give back is a RULE, and a rule buried in a 2,500-line component is a rule
 * nobody tests. It was hand-rolled as `!item.nonReturnable` and so silently
 * swallowed every clearance line: the goods were exchangeable, the checkout
 * would have accepted them, the cashier just never saw them to pick.
 */
export interface ExchangePickerLine {
  saleItemId: number;
  productName: string;
  size: string;
  color: string;
  sku: string;
  barcode: string;
  available: number;
  quantity: number;
  condition: 'resellable' | 'damaged';
  unitPrice: number;
  selected: boolean;
  /** §2.4 — a clearance line exchanges freely but cannot settle as cash out. */
  isClearance: boolean;
}

/**
 * @param saleItems         `sale.items` straight off `GET /sales/:id`
 * @param preselectSaleItemId the line the cashier scanned, if any
 */
export function buildExchangeItems(
  saleItems: any[] | null | undefined,
  preselectSaleItemId?: number
): ExchangePickerLine[] {
  return (saleItems || [])
    // §2.4 — one rule, shared with the server (`canExchangeLine`), so the picker
    // offers exactly the lines a checkout would accept. A product flagged
    // non-returnable blocks everything; a cashier-flagged line blocks too,
    // EXCEPT a clearance line, which carries that same flag automatically at
    // checkout to gate refunds and was never meant to stop a swap. Genuine
    // exchange-only products are still allowed.
    .filter((it: any) =>
      canExchangeLine({
        isClearance: Boolean(it.isClearance),
        lineNonReturnable: Boolean(it.nonReturnable),
        productNonReturnable: Boolean(it.variant?.product?.nonReturnable),
      })
    )
    .map((it: any) => {
      const available = (it.quantity || 0) - (it.returnedQuantity || 0);
      const preselected = preselectSaleItemId === it.id;
      return {
        saleItemId: it.id,
        productName: it.variant?.product?.name || it.productName || 'Item',
        size: it.variant?.size || '-',
        color: it.variant?.color || '-',
        sku: it.variant?.sku || '-',
        barcode: it.variant?.barcode || '-',
        available,
        // A scanned item means "this one unit is coming back" — default its qty
        // to 1; otherwise default to all returnable.
        quantity: preselected ? 1 : available,
        condition: 'resellable' as const,
        // Credit the actual paid-per-unit (line total ÷ qty, net of every
        // discount), not MRP/effective — so a 10%-off 4k item credits 3.6k.
        unitPrice:
          it.total != null && it.quantity
            ? Number(it.total) / it.quantity
            : Number(it.effectiveUnitPrice ?? it.unitPrice) || 0,
        selected: preselected,
        isClearance: Boolean(it.isClearance),
      };
    })
    .filter((i) => i.available > 0);
}
