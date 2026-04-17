/**
 * Driver-agnostic label IR.
 *
 * All coordinates are in **mm** from the top-left of the label.
 * Font sizes are in **typographic points** (1 pt = 0.3528 mm).
 * Each driver maps `fontSizePt` to its closest native font.
 *
 * This IR is deliberately independent of printer DPI, command language, or
 * transport. A `LabelTemplate` is data that the frontend designer produces
 * and backend drivers consume.
 */

export type LabelElementType =
  | 'brand'
  | 'productName'
  | 'variant'
  | 'barcode'
  | 'sku'
  | 'price'
  | 'lotCode'
  | 'text';

export type TextAlign = 'left' | 'center' | 'right';
export type TextWeight = 'normal' | 'bold';

export type BarcodeType =
  | 'code128'
  | 'code39'
  | 'ean13'
  | 'ean8'
  | 'upca'
  | 'qr';

/**
 * A single positioned element on the label.
 *
 * Fields that are irrelevant to the element type may be omitted or null.
 * For example, `barcodeType` is ignored for text elements, `content` is
 * ignored for data-bound elements (productName, variant, sku, price).
 */
export interface LabelElement {
  id: string;
  type: LabelElementType;

  // Position (mm from top-left)
  xMm: number;
  yMm: number;

  visible?: boolean;

  // Text elements
  fontSizePt?: number;
  weight?: TextWeight;
  align?: TextAlign;
  /** Optional bounding width (mm) — used for alignment within a text box. */
  widthMm?: number;
  underline?: boolean;
  /** Static text for `brand`, `text`, or as a prefix for `price`. */
  content?: string;

  // Barcode elements
  barcodeType?: BarcodeType;
  barcodeHeightMm?: number;
  showBarcodeText?: boolean;
}

/**
 * A complete label design ready to print.
 *
 * The label's physical size is stored on the template (not the printer profile)
 * because a single printer can be loaded with different media rolls.
 */
export interface LabelTemplate {
  widthMm: number;
  heightMm: number;
  gapMm: number;
  /** Print darkness/density: driver-specific range, typically 0-15. */
  density: number;
  /** Print speed in inches/sec: driver-specific range, typically 1-14. */
  speed: number;
  elements: LabelElement[];
}

/**
 * The data bound to one printed label.
 */
export interface LabelData {
  sku: string;
  productName: string;
  variantLabel?: string;
  price: number;
  lotCode?: string;
  /** Number of copies of this exact label. */
  copies?: number;
}
