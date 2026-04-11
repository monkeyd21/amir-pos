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
import { asciiSanitize, resolveElementText } from '../ir/resolveText';

/**
 * EPL2 (Eltron Programming Language) driver.
 *
 * Covers: legacy Zebra LP 2824, TLP 2844, LP 2542, TLP 3844, TLP 2722.
 * These are still extremely common in Indian retail because they're
 * cheap and bulletproof. Most newer Zebra firmware also speaks EPL2
 * via emulation.
 *
 * EPL2 is simpler than ZPL:
 *   A x,y,rot,font,hMul,vMul,reverse,"text"   ← text
 *   B x,y,rot,type,narrow,wide,height,readable,"data"  ← barcode
 *   X x1,y1,thickness,x2,y2                   ← filled box (for underline)
 *
 * Coordinates are in dots. Fonts 1-5 are bitmap (same as TSPL family
 * wise, different actual metrics).
 */

interface Epl2Font {
  id: 1 | 2 | 3 | 4 | 5;
  charWidthDots: number;
  charHeightDots: number;
}

// EPL2 built-in fonts at 203 DPI (from the EPL2 Programmer's Manual):
const EPL2_FONTS: Epl2Font[] = [
  { id: 1, charWidthDots: 8, charHeightDots: 12 },
  { id: 2, charWidthDots: 10, charHeightDots: 16 },
  { id: 3, charWidthDots: 12, charHeightDots: 20 },
  { id: 4, charWidthDots: 14, charHeightDots: 24 },
  { id: 5, charWidthDots: 32, charHeightDots: 48 },
];

const mmToDots = (mm: number, dpi: number) => Math.round((mm * dpi) / 25.4);

interface ResolvedFont {
  font: Epl2Font;
  mult: number;
  charWidthDots: number;
  charHeightDots: number;
}

function resolveFont(fontSizePt: number, dpi: number): ResolvedFont {
  const targetHeightDots = fontSizePt * 0.3528 * (dpi / 25.4);
  let chosen = EPL2_FONTS[0];
  for (const f of EPL2_FONTS) {
    if (f.charHeightDots <= targetHeightDots) chosen = f;
  }
  let mult = 1;
  if (targetHeightDots > chosen.charHeightDots * 1.25) {
    mult = Math.max(1, Math.min(8, Math.round(targetHeightDots / chosen.charHeightDots)));
  }
  return {
    font: chosen,
    mult,
    charWidthDots: chosen.charWidthDots * mult,
    charHeightDots: chosen.charHeightDots * mult,
  };
}

function alignedXDots(
  el: LabelElement,
  text: string,
  font: ResolvedFont,
  dpi: number
): number {
  const baseX = mmToDots(el.xMm, dpi);
  if (!el.widthMm || !el.align || el.align === 'left') return baseX;
  const box = mmToDots(el.widthMm, dpi);
  const textWidth = text.length * font.charWidthDots;
  const free = box - textWidth;
  if (free <= 0) return baseX;
  if (el.align === 'center') return baseX + Math.floor(free / 2);
  return baseX + free;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return text.slice(0, max);
  return text.slice(0, max - 1) + '.';
}

function barcodeTypeCode(type: BarcodeType | undefined): string {
  switch (type) {
    case 'code39':
      return '3';
    case 'ean13':
      return 'E30';
    case 'ean8':
      return 'E20';
    case 'upca':
      return 'UA0';
    case 'qr':
      // EPL2 has limited QR support — most LP2844 firmware doesn't do QR.
      // Fall back to Code 128 so at least something prints.
      return '1';
    case 'code128':
    default:
      return '1';
  }
}

function renderElement(
  el: LabelElement,
  data: LabelData,
  dpi: number
): string[] {
  if (el.visible === false) return [];

  if (el.type === 'barcode') {
    const sku = asciiSanitize(data.sku);
    if (!sku) return [];
    const x = mmToDots(el.xMm, dpi);
    const y = mmToDots(el.yMm, dpi);
    const height = Math.max(20, mmToDots(el.barcodeHeightMm ?? 10, dpi));
    const readable = el.showBarcodeText === false ? 'N' : 'B';
    const type = barcodeTypeCode(el.barcodeType);
    // B x,y,rotation,type,narrow,wide,height,readable,"data"
    return [`B${x},${y},0,${type},2,4,${height},${readable},"${sku}"`];
  }

  const raw = resolveElementText(el, data);
  if (!raw) return [];
  const resolved = resolveFont(el.fontSizePt ?? 12, dpi);
  let text = asciiSanitize(raw);
  if (el.widthMm) {
    const box = mmToDots(el.widthMm, dpi);
    const maxChars = Math.max(1, Math.floor(box / resolved.charWidthDots));
    text = truncate(text, maxChars);
  }
  if (!text) return [];
  const x = alignedXDots(el, text, resolved, dpi);
  const y = mmToDots(el.yMm, dpi);

  // A x,y,rot,font,hMul,vMul,reverse,"text"
  const reverse = 'N';
  const out: string[] = [
    `A${x},${y},0,${resolved.font.id},${resolved.mult},${resolved.mult},${reverse},"${text}"`,
  ];

  if (el.weight === 'bold') {
    out.push(
      `A${x + 1},${y},0,${resolved.font.id},${resolved.mult},${resolved.mult},${reverse},"${text}"`
    );
  }

  if (el.underline) {
    const textWidth = text.length * resolved.charWidthDots;
    const barY = y + resolved.charHeightDots + 2;
    // X x1,y1,thickness,x2,y2 — draws a filled box between (x1,y1) and (x2,y2).
    out.push(`X${x},${barY},2,${x + textWidth},${barY + 2}`);
  }

  return out;
}

function renderOneLabel(
  template: LabelTemplate,
  item: LabelData,
  dpi: number
): string {
  const copies = Math.max(1, Math.min(item.copies ?? 1, 99));
  const widthDots = mmToDots(template.widthMm, dpi);
  const heightDots = mmToDots(template.heightMm, dpi);
  const gapDots = mmToDots(template.gapMm, dpi);

  const lines: string[] = [
    'N',                                          // clear image buffer
    `q${widthDots}`,                              // set label width (dots)
    `Q${heightDots},${gapDots}`,                  // set label + gap length
    `D${Math.max(0, Math.min(15, template.density))}`, // density
    `S${Math.max(1, Math.min(14, template.speed))}`,   // speed
    'ZT',                                         // print direction: top first
  ];
  for (const el of template.elements) {
    lines.push(...renderElement(el, item, dpi));
  }
  lines.push(`P${copies}`);                       // print quantity
  return lines.join('\n') + '\n';
}

// ─── Driver singleton ────────────────────────────────────────────

class Epl2Driver implements Driver {
  readonly name = 'epl2';
  readonly displayName = 'EPL2 (Legacy Zebra LP2824, TLP2844, LP2542)';

  readonly capabilities: DriverCapabilities = {
    // EPL2 QR support is spotty — advertise only the standards every
    // EPL2 printer handles reliably.
    supportedBarcodes: ['code128', 'code39', 'ean13', 'ean8', 'upca'],
    unicode: false,
    nativeBold: false,
    densityRange: [0, 15],
    speedRange: [1, 14],
  };

  async render(
    template: LabelTemplate,
    items: LabelData[],
    ctx: RenderContext
  ): Promise<DriverOutput> {
    const body = items
      .map((item) => renderOneLabel(template, item, ctx.dpi))
      .join('');
    const bytes = Buffer.from(body, 'binary');
    return {
      bytes,
      contentType: 'application/x-epl2',
      summary: `${bytes.length} EPL2 bytes, ${items.length} label(s)`,
    };
  }
}

registerDriver(new Epl2Driver());
