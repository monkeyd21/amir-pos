// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit');
import * as bwipjs from 'bwip-js';

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
 * PDF fallback driver.
 *
 * This driver doesn't speak any thermal-printer command language —
 * it produces a PDF sized to the exact label dimensions and relies
 * on the OS print spooler (via `cups` or `win-spool` transport) to
 * deliver it to whichever printer the customer has configured.
 *
 * This makes ANY OS-installed printer a valid target:
 *   - A4 laser for draft labels on plain paper
 *   - An InkJet multi-function for color labels
 *   - A networked Xerox / Ricoh copier
 *   - Any thermal printer that ships its own OS driver (Dymo,
 *     Brother QL, Seiko) — the OS driver handles the rasterization
 *
 * Accuracy is perfect because PDF is the reference rendering — the
 * designer sees exactly what prints, down to the mm.
 */

// ─── mm ↔ points ─────────────────────────────────────────────────
// PDF uses points (1 pt = 1/72 inch). 1 mm = 2.8346 pt.
const MM_TO_PT = 72 / 25.4;

const bwipBcid: Record<BarcodeType, string> = {
  code128: 'code128',
  code39: 'code39',
  ean13: 'ean13',
  ean8: 'ean8',
  upca: 'upca',
  qr: 'qrcode',
};

// ─── Vector bar capture ──────────────────────────────────────────
// The previous driver embedded the barcode as a rasterized PNG, which the
// browser/OS print pipeline then bilinear-smoothed — blurring the bars into
// an unreadable wavy pattern. Instead we take bwip-js's `raw()` module grid
// (`sbs` = alternating bar/space widths, bar-first) and draw the bars as
// VECTOR rectangles at exact integer-module boundaries — crisp at any DPI and
// geometrically perfect (no raster pixel-snapping distortion of bar ratios).
//
// Only LINEAR (1D) symbologies expose a single `sbs`. QR / 2D / composite
// codes return a different structure → we fall back to the PNG path.
interface CapturedBars {
  bars: { x: number; w: number }[]; // module space, x = left edge
  unitW: number; // total symbol width in modules
}

function captureLinearBars(type: BarcodeType, text: string): CapturedBars | null {
  let arr: any;
  try {
    arr = (bwipjs as any).raw({ bcid: bwipBcid[type], text });
  } catch {
    return null;
  }
  // A single linear segment with an sbs array; anything else → PNG fallback.
  if (!Array.isArray(arr) || arr.length !== 1) return null;
  const sbs = arr[0]?.sbs;
  if (!Array.isArray(sbs) || sbs.length === 0) return null;

  const bars: { x: number; w: number }[] = [];
  let cursor = 0;
  for (let i = 0; i < sbs.length; i++) {
    const w = sbs[i];
    if (i % 2 === 0 && w > 0) bars.push({ x: cursor, w }); // even index = bar
    cursor += w;
  }
  if (bars.length === 0 || cursor <= 0) return null;
  return { bars, unitW: cursor };
}

/**
 * Render a barcode element. LINEAR barcodes are drawn as crisp VECTOR bars
 * (see captureLinearBars). QR / 2D and any failure fall back to an embedded
 * PNG via bwip-js.
 */
async function drawBarcode(
  doc: any,
  el: LabelElement,
  data: LabelData,
  labelWidthMm: number
): Promise<void> {
  const text = (data.sku ?? '').trim();
  if (!text) return;
  const type: BarcodeType = el.barcodeType ?? 'code128';
  const heightMm = el.barcodeHeightMm ?? 10;
  const includetext = el.showBarcodeText !== false;
  const xPt = el.xMm * MM_TO_PT;
  const yPt = el.yMm * MM_TO_PT;

  // ── Vector path for 1D barcodes ──
  if (type !== 'qr') {
    const cap = captureLinearBars(type, text);
    if (cap) {
      // Pick the module (X-dimension) width. Target ~0.33 mm (13 mil) for
      // reliable handheld scanning, but shrink to fit the label if needed.
      const availMm = Math.max(10, labelWidthMm - el.xMm - 2);
      const unitMm = el.widthMm
        ? el.widthMm / cap.unitW
        : Math.max(0.19, Math.min(0.33, availMm / cap.unitW));
      const barsHeightPt = heightMm * MM_TO_PT;
      const unitPt = unitMm * MM_TO_PT;

      doc.save();
      doc.fillColor('#000000');
      for (const b of cap.bars) {
        doc.rect(xPt + b.x * unitPt, yPt, b.w * unitPt, barsHeightPt).fill();
      }
      doc.restore();

      // Human-readable line, drawn as vector Helvetica centred under the bars.
      if (includetext) {
        const totalWidthPt = cap.unitW * unitPt;
        let fontSize = 9;
        doc.font('Helvetica');
        while (fontSize > 5) {
          doc.fontSize(fontSize);
          if (doc.widthOfString(text) <= totalWidthPt) break;
          fontSize -= 0.5;
        }
        doc.fillColor('#000000').font('Helvetica').fontSize(fontSize);
        doc.text(text, xPt, yPt + barsHeightPt + 1, {
          width: totalWidthPt,
          align: 'center',
          lineBreak: false,
        });
      }
      return;
    }
    // else: fall through to the PNG fallback below.
  }

  // ── PNG fallback (QR / 2D, or if vector capture failed) ──
  try {
    const png = await bwipjs.toBuffer({
      bcid: bwipBcid[type],
      text,
      scale: 3,
      height: type === 'qr' ? undefined : heightMm,
      includetext,
      textxalign: 'center',
      textsize: 8,
      paddingwidth: 0,
      paddingheight: 0,
    });
    if (type === 'qr') {
      const sizePt = heightMm * MM_TO_PT;
      doc.image(png, xPt, yPt, { width: sizePt, height: sizePt });
    } else {
      const heightPt = (heightMm + (includetext ? 3 : 0)) * MM_TO_PT;
      if (el.widthMm) {
        doc.image(png, xPt, yPt, { width: el.widthMm * MM_TO_PT, height: heightPt });
      } else {
        doc.image(png, xPt, yPt, { height: heightPt });
      }
    }
  } catch (err: any) {
    console.warn(
      `[pdf driver] barcode render failed for ${type} "${text}": ${err?.message ?? err}`
    );
  }
}

function drawText(
  doc: any,
  el: LabelElement,
  data: LabelData
): void {
  const raw = resolveElementText(el, data);
  if (!raw) return;
  const text = raw.replace(/[\r\n]/g, ' ').trim();
  if (!text) return;

  const xPt = el.xMm * MM_TO_PT;
  const yPt = el.yMm * MM_TO_PT;
  const designedSize = el.fontSizePt ?? 12;

  // Helvetica is built into every PDF reader and covers all ASCII.
  const fontName = el.weight === 'bold' ? 'Helvetica-Bold' : 'Helvetica';

  // Shrink-to-fit: pdfkit's `lineBreak: false` doesn't reliably keep text on
  // one line when both `width` and `align` are set, so long real-world values
  // (e.g. "Levis 501 Original Jeans" in a 45mm productName slot) wrapped and
  // overlapped neighboring elements. Step the font size down until the text
  // fits on a single line, with a 6pt floor — better than truncating, since
  // labels still need the full text to be legible.
  let fontSize = designedSize;
  if (el.widthMm) {
    const maxWidthPt = el.widthMm * MM_TO_PT;
    doc.font(fontName);
    while (fontSize > 6) {
      doc.fontSize(fontSize);
      if (doc.widthOfString(text) <= maxWidthPt) break;
      fontSize -= 0.5;
    }
  }
  doc.font(fontName).fontSize(fontSize);

  if (el.widthMm && el.align) {
    doc.text(text, xPt, yPt, {
      width: el.widthMm * MM_TO_PT,
      align: el.align,
      underline: el.underline === true,
      lineBreak: false,
    });
  } else {
    doc.text(text, xPt, yPt, {
      underline: el.underline === true,
      lineBreak: false,
    });
  }
}

async function drawLabel(
  doc: any,
  template: LabelTemplate,
  item: LabelData
): Promise<void> {
  for (const el of template.elements) {
    if (el.visible === false) continue;
    if (el.type === 'barcode') {
      await drawBarcode(doc, el, item, template.widthMm);
    } else {
      drawText(doc, el, item);
    }
  }
}

async function renderPdf(
  template: LabelTemplate,
  items: LabelData[]
): Promise<Buffer> {
  const widthPt = template.widthMm * MM_TO_PT;
  const heightPt = template.heightMm * MM_TO_PT;

  const doc = new PDFDocument({
    size: [widthPt, heightPt],
    margin: 0,
    autoFirstPage: false,
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  for (const item of items) {
    const copies = Math.max(1, Math.min(item.copies ?? 1, 99));
    for (let i = 0; i < copies; i++) {
      doc.addPage({ size: [widthPt, heightPt], margin: 0 });
      await drawLabel(doc, template, item);
    }
  }

  doc.end();
  return done;
}

// ─── Driver singleton ────────────────────────────────────────────

class PdfDriver implements Driver {
  readonly name = 'pdf';
  readonly displayName = 'PDF (universal — any OS-installed printer)';

  readonly capabilities: DriverCapabilities = {
    supportedBarcodes: ['code128', 'code39', 'ean13', 'ean8', 'upca', 'qr'],
    unicode: true,
    nativeBold: true,
    densityRange: [0, 15], // ignored by PDF — the OS driver handles it
    speedRange: [1, 14],   // ignored by PDF
  };

  async render(
    template: LabelTemplate,
    items: LabelData[],
    _ctx: RenderContext
  ): Promise<DriverOutput> {
    const bytes = await renderPdf(template, items);
    return {
      bytes,
      contentType: 'application/pdf',
      summary: `${bytes.length}-byte PDF, ${items.length} label(s)`,
    };
  }
}

registerDriver(new PdfDriver());
