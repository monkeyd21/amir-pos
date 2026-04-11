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

/**
 * Render a barcode element to a PNG buffer via bwip-js, then embed it
 * at the right (x, y) in points. For QR codes the element's
 * `barcodeHeightMm` is used as the square side length.
 */
async function drawBarcode(
  doc: any,
  el: LabelElement,
  data: LabelData
): Promise<void> {
  const text = (data.sku ?? '').trim();
  if (!text) return;
  const type: BarcodeType = el.barcodeType ?? 'code128';
  const heightMm = el.barcodeHeightMm ?? 10;
  const includetext = el.showBarcodeText !== false;

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
    const xPt = el.xMm * MM_TO_PT;
    const yPt = el.yMm * MM_TO_PT;
    if (type === 'qr') {
      const sizePt = heightMm * MM_TO_PT;
      doc.image(png, xPt, yPt, { width: sizePt, height: sizePt });
    } else {
      // Let pdfkit fit the image to the bounding height; width is
      // determined by aspect ratio. If an explicit widthMm is supplied,
      // use it.
      const heightPt = (heightMm + (includetext ? 3 : 0)) * MM_TO_PT;
      if (el.widthMm) {
        doc.image(png, xPt, yPt, {
          width: el.widthMm * MM_TO_PT,
          height: heightPt,
        });
      } else {
        doc.image(png, xPt, yPt, { height: heightPt });
      }
    }
  } catch (err: any) {
    // Corrupt input (e.g. EAN-13 with non-digit SKU) — skip this element
    // rather than blow up the entire batch.
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
  const fontSize = el.fontSizePt ?? 12;

  // Helvetica is built into every PDF reader and covers all ASCII.
  const fontName = el.weight === 'bold' ? 'Helvetica-Bold' : 'Helvetica';
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
      await drawBarcode(doc, el, item);
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
