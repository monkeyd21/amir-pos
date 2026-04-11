import { LabelData, LabelTemplate, BarcodeType } from '../ir/types';

/**
 * Capabilities advertised by a driver. Used by the frontend designer to
 * filter which barcode types and features are selectable when a given
 * printer profile is active.
 */
export interface DriverCapabilities {
  supportedBarcodes: BarcodeType[];
  /** True if the driver can render non-ASCII (UTF-8) text. */
  unicode: boolean;
  /** True if the driver can print weights (bold) natively (not just double-strike). */
  nativeBold: boolean;
  /** Typical physical range for density/darkness values. */
  densityRange: [number, number];
  /** Typical physical range for speed values (ips). */
  speedRange: [number, number];
}

/**
 * Bytes + content type produced by a driver. Most thermal drivers return
 * plain command-language text (TSPL/ZPL/EPL2) encoded as UTF-8 or binary.
 * The PDF driver returns `application/pdf`.
 */
export interface DriverOutput {
  bytes: Buffer;
  contentType: string;
  /** Human-readable summary ("42 TSPL bytes", "1.2KB PDF") — for logging. */
  summary: string;
}

/**
 * Render context supplied to a driver at print time.
 * DPI matters for drivers that need to convert IR mm → native dots.
 */
export interface RenderContext {
  dpi: number;
}

/**
 * A Driver renders a template + data rows into the printer's native
 * command language. It has no knowledge of how the bytes get to the
 * printer — that's the Transport's job.
 *
 * `render` is async for uniformity with the PDF driver. Thermal drivers
 * that build their output synchronously simply `return Promise.resolve(...)`.
 */
export interface Driver {
  /** Unique identifier. Stored in `PrinterProfile.driver`. */
  readonly name: string;
  /** Human-readable label for the settings UI. */
  readonly displayName: string;

  readonly capabilities: DriverCapabilities;

  render(
    template: LabelTemplate,
    items: LabelData[],
    ctx: RenderContext
  ): Promise<DriverOutput>;
}
