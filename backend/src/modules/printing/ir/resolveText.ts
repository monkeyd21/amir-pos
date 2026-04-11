import { LabelData, LabelElement } from './types';

/**
 * Resolve the text to print for a given element, given the data being printed.
 *
 * Shared by all drivers so that the semantics of element types (brand vs
 * productName vs price prefix) stay consistent regardless of command language.
 */
export function resolveElementText(
  el: LabelElement,
  data: LabelData
): string {
  switch (el.type) {
    case 'brand':
      return el.content ?? '';
    case 'productName':
      return data.productName ?? '';
    case 'variant':
      return data.variantLabel ?? '';
    case 'sku':
      return data.sku ?? '';
    case 'price': {
      const prefix = (el.content ?? '').trim();
      const amount = Math.round(data.price ?? 0);
      return prefix ? `${prefix} ${amount}` : String(amount);
    }
    case 'text':
      return el.content ?? '';
    default:
      return '';
  }
}

/** ASCII-safe sanitizer for printers that only speak 7-bit (TSPL/ZPL/EPL2). */
export function asciiSanitize(text: string): string {
  return text
    .replace(/[\r\n]/g, ' ')
    .replace(/"/g, "'")
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
}
