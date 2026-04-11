import {
  Driver,
  DriverCapabilities,
  DriverOutput,
  RenderContext,
} from './base';
import { registerDriver } from './registry';
import {
  BarcodeType,
  LabelData,
  LabelElement,
  LabelTemplate,
} from '../ir/types';
import { resolveElementText } from '../ir/resolveText';

/**
 * ESC/POS label-mode driver.
 *
 * Covers: Epson TM-L90 / TM-L100, Star TSP 654 label version, Bixolon
 * SLP-TX403, SRP-S300L.  These are receipt-style printers with a label
 * mode — they have a cutter/peeler and die-cut media support.
 *
 * ESC/POS is inherently linear (top-down flow), not absolute-positioned
 * like TSPL/ZPL/EPL2. To place elements at arbitrary (x, y) on one
 * label we build a "virtual page" per label:
 *
 *   1. Group elements by ascending yMm
 *   2. At each new y, emit a line feed (via ESC J n — advance n dots)
 *   3. Use ESC $ nL nH to set the absolute horizontal position
 *   4. Emit text or GS k barcode at that position
 *   5. Close the label with a full cut or partial cut
 *
 * This is good-enough for typical price tags. For complex designs on
 * ESC/POS hardware, customers should prefer the PDF driver.
 */

// ── Byte helpers ────────────────────────────────────────────────

const ESC = 0x1b;
const GS = 0x1d;

function enc(s: string): number[] {
  return Array.from(Buffer.from(s, 'ascii'));
}

const mmToDots = (mm: number, dpi: number) => Math.round((mm * dpi) / 25.4);

// ── Barcode type selector (GS k function 73 is the modern one) ──

function barcodeSelector(type: BarcodeType | undefined): number {
  // m values for GS k function 65 (m=65..79 range for newer command)
  switch (type) {
    case 'code39':
      return 69; // CODE39 (fn 65)
    case 'ean13':
      return 67;
    case 'ean8':
      return 68;
    case 'upca':
      return 65;
    case 'qr':
      // QR uses a whole different command (GS ( k) — handled separately
      return -1;
    case 'code128':
    default:
      return 73;
  }
}

function escapeTextForEscPos(text: string): string {
  return text.replace(/[\r\n\x00-\x1f]/g, ' ').trim();
}

// ── Font size (pt) → ESC ! size multiplier ──────────────────────
//
// ESC/POS supports width/height multipliers via GS ! (0x1D 0x21) with a
// single byte where bits 4-6 = height multiplier (0-7), bits 0-2 =
// width multiplier. The base font (~12 dots tall @ 203 DPI) covers
// about 8 pt; we scale up from there.

function sizeMultiplier(fontSizePt: number): number {
  // Base font ≈ 8 pt (Font A at 203 DPI is 12 dots tall).
  // Clamp between 0 and 7.
  const ratio = Math.max(1, Math.round(fontSizePt / 8));
  const m = Math.max(0, Math.min(7, ratio - 1));
  return (m << 4) | m; // same width & height scale
}

// ── Emit one element as bytes at current print head position ────

function emitElementAt(
  el: LabelElement,
  data: LabelData,
  dpi: number,
  out: number[]
): void {
  if (el.visible === false) return;

  const xDots = mmToDots(el.xMm, dpi);

  // ESC $ nL nH — set absolute horizontal print position (in dots)
  out.push(ESC, 0x24, xDots & 0xff, (xDots >> 8) & 0xff);

  if (el.type === 'barcode') {
    const sku = escapeTextForEscPos(data.sku);
    if (!sku) return;
    const heightDots = Math.max(20, mmToDots(el.barcodeHeightMm ?? 10, dpi));

    // GS h n — barcode height
    out.push(GS, 0x68, Math.min(255, heightDots));
    // GS w n — module width (2 = narrow, 3 = default, 6 = max)
    out.push(GS, 0x77, 2);
    // GS H n — HRI (human readable interpretation) position: 0=none, 1=above, 2=below, 3=both
    out.push(GS, 0x48, el.showBarcodeText === false ? 0 : 2);

    if (el.barcodeType === 'qr') {
      // GS ( k — QR code family
      // Model: GS ( k pL pH cn fn n1 n2 → set model 2
      const qr = Buffer.from([
        GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00, // model 2
        GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x08,        // module size 8
        GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31,        // error correction L
      ]);
      out.push(...qr);
      // Store data in symbol
      const dataBytes = Buffer.from(sku, 'ascii');
      const len = dataBytes.length + 3;
      out.push(GS, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 0x31, 0x50, 0x30, ...dataBytes);
      // Print from symbol storage
      out.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30);
    } else {
      // GS k m fn = 65..79 for variable-length barcodes
      const m = barcodeSelector(el.barcodeType);
      const dataBytes = Buffer.from(sku, 'ascii');
      out.push(GS, 0x6b, m, dataBytes.length, ...dataBytes);
    }

    // Line feed after barcode so the next element isn't on the same row
    out.push(0x0a);
    return;
  }

  const raw = resolveElementText(el, data);
  if (!raw) return;
  const text = escapeTextForEscPos(raw);
  if (!text) return;

  // ESC a n — justification: 0=left, 1=center, 2=right
  // Only emit if we have a widthMm (else respect the raw xDots).
  if (el.widthMm && el.align) {
    const jn = el.align === 'center' ? 1 : el.align === 'right' ? 2 : 0;
    out.push(ESC, 0x61, jn);
  }

  // GS ! n — select font character size
  out.push(GS, 0x21, sizeMultiplier(el.fontSizePt ?? 12));

  // ESC E n — emphasize (bold): n=1 on, n=0 off
  if (el.weight === 'bold') out.push(ESC, 0x45, 0x01);

  // ESC - n — underline: 0=off, 1=1-dot, 2=2-dot
  if (el.underline) out.push(ESC, 0x2d, 0x02);

  out.push(...enc(text), 0x0a);

  // Reset styles so the next element starts clean
  if (el.underline) out.push(ESC, 0x2d, 0x00);
  if (el.weight === 'bold') out.push(ESC, 0x45, 0x00);
  out.push(GS, 0x21, 0x00);
  if (el.widthMm && el.align) out.push(ESC, 0x61, 0x00);
}

function renderOneLabel(
  template: LabelTemplate,
  item: LabelData,
  dpi: number
): Buffer {
  const out: number[] = [];

  // ESC @ — initialize printer
  out.push(ESC, 0x40);

  // Set label mode: GS ( L for page mode + label length.
  // Different vendors use different commands; the safest is to rely on
  // the printer's mechanical label sensor + pre-configured label length.
  // We emit a best-effort GS f 0 / GS f 1 page/standard mode no-op.

  // Sort elements by y so the cursor advances monotonically top-down.
  const sortedElements = [...template.elements].sort((a, b) => a.yMm - b.yMm);

  let cursorYDots = 0;
  for (const el of sortedElements) {
    const targetY = mmToDots(el.yMm, dpi);
    const advance = targetY - cursorYDots;
    if (advance > 0) {
      // ESC J n — print and feed n dots (n = 0..255)
      let remaining = advance;
      while (remaining > 0) {
        const step = Math.min(255, remaining);
        out.push(ESC, 0x4a, step);
        remaining -= step;
      }
      cursorYDots = targetY;
    }
    emitElementAt(el, item, dpi, out);
    // emitElementAt emits its own LF after text/barcode — estimate advance
    cursorYDots += Math.max(24, mmToDots((el.fontSizePt ?? 12) * 0.4, dpi));
  }

  // Feed to end of label and cut
  out.push(ESC, 0x64, 2);        // ESC d n — feed n lines
  out.push(GS, 0x56, 0x41, 0x00); // GS V A 0 — full cut

  const copies = Math.max(1, Math.min(item.copies ?? 1, 99));
  const one = Buffer.from(out);
  if (copies === 1) return one;
  const parts: Buffer[] = [];
  for (let i = 0; i < copies; i++) parts.push(one);
  return Buffer.concat(parts);
}

// ─── Driver singleton ────────────────────────────────────────────

class EscPosLabelDriver implements Driver {
  readonly name = 'escpos-label';
  readonly displayName = 'ESC/POS Label Mode (Epson TM-L90, Star TSP, Bixolon SLP)';

  readonly capabilities: DriverCapabilities = {
    // ESC/POS variants sometimes skip QR on label models. Keep the
    // defensive list — designers can still pick QR but may need to test.
    supportedBarcodes: ['code128', 'code39', 'ean13', 'ean8', 'upca', 'qr'],
    unicode: false,
    nativeBold: true,   // ESC E n is real bold, not double-strike
    densityRange: [0, 15],
    speedRange: [1, 14],
  };

  async render(
    template: LabelTemplate,
    items: LabelData[],
    ctx: RenderContext
  ): Promise<DriverOutput> {
    const parts = items.map((item) => renderOneLabel(template, item, ctx.dpi));
    const bytes = Buffer.concat(parts);
    return {
      bytes,
      contentType: 'application/octet-stream',
      summary: `${bytes.length} ESC/POS bytes, ${items.length} label(s)`,
    };
  }
}

registerDriver(new EscPosLabelDriver());
