/**
 * Known printer model database.
 *
 * When the discovery wizard finds a printer (either from an OS queue
 * name or from a TCP probe), it runs the printer's name/description
 * through this database to guess the best driver, DPI, and capabilities.
 * The user can always override the match in the settings form.
 *
 * Each entry is a regex matched against the candidate name/description.
 * Order matters — first match wins. Place more specific patterns first.
 *
 * ───────────────────────────────────────────────────────────────
 * Adding a new model:
 *   1. Append an entry with a pattern that matches the vendor's
 *      typical device name. Test with the OS queue name you see in
 *      Windows → Printers & Scanners or `lpstat -a` output.
 *   2. Set driver to one of: tspl / zpl / epl2 / escpos-label / pdf
 *   3. Set dpi (common values: 203 or 300)
 *   4. Set maxWidthMm (2-inch = ~52mm printable, 4-inch = ~104mm)
 *   5. List supportedBarcodes — conservatively.
 * ───────────────────────────────────────────────────────────────
 */

import { BarcodeType } from '../ir/types';

export interface VendorMatch {
  vendor: string;
  model: string;
  driver: 'tspl' | 'zpl' | 'epl2' | 'escpos-label' | 'pdf';
  dpi: number;
  maxWidthMm: number;
  supportedBarcodes: BarcodeType[];
}

interface VendorPattern extends VendorMatch {
  pattern: RegExp;
}

const VENDOR_DATABASE: VendorPattern[] = [
  // ─── TVS Electronics (priority: #1 for Indian clothing retail) ────
  {
    pattern: /TVS[\s\-]*(?:LP\s*46|LP46)\s*(Neo|Lite|Pro)?/i,
    vendor: 'tvs',
    model: 'LP 46',
    driver: 'tspl',
    dpi: 203,
    maxWidthMm: 108,
    supportedBarcodes: ['code128', 'code39', 'ean13', 'ean8', 'upca', 'qr'],
  },
  {
    pattern: /TVS[\s\-]*(?:LP\s*45|LP45)/i,
    vendor: 'tvs',
    model: 'LP 45',
    driver: 'tspl',
    dpi: 203,
    maxWidthMm: 108,
    supportedBarcodes: ['code128', 'code39', 'ean13', 'ean8', 'upca'],
  },
  {
    pattern: /TVS[\s\-]*(?:LP\s*44|LP44)/i,
    vendor: 'tvs',
    model: 'LP 44',
    driver: 'tspl',
    dpi: 203,
    maxWidthMm: 108,
    supportedBarcodes: ['code128', 'code39', 'ean13', 'ean8', 'upca'],
  },

  // ─── TSC (TSPL inventors) ─────────────────────────────────────────
  {
    pattern: /TSC\s*TTP[\s\-]*244/i,
    vendor: 'tsc',
    model: 'TTP-244',
    driver: 'tspl',
    dpi: 203,
    maxWidthMm: 108,
    supportedBarcodes: ['code128', 'code39', 'ean13', 'ean8', 'upca', 'qr'],
  },
  {
    pattern: /TSC\s*TE\d+/i,
    vendor: 'tsc',
    model: 'TE Series',
    driver: 'tspl',
    dpi: 203,
    maxWidthMm: 108,
    supportedBarcodes: ['code128', 'code39', 'ean13', 'ean8', 'upca', 'qr'],
  },
  {
    pattern: /TSC\s*DA\d+/i,
    vendor: 'tsc',
    model: 'DA Series',
    driver: 'tspl',
    dpi: 203,
    maxWidthMm: 108,
    supportedBarcodes: ['code128', 'code39', 'ean13', 'ean8', 'upca', 'qr'],
  },
  {
    pattern: /\bTSC\b/i,
    vendor: 'tsc',
    model: 'Generic TSC',
    driver: 'tspl',
    dpi: 203,
    maxWidthMm: 108,
    supportedBarcodes: ['code128', 'code39', 'ean13', 'ean8', 'upca', 'qr'],
  },

  // ─── Zebra (ZPL II) ───────────────────────────────────────────────
  {
    pattern: /Zebra\s*ZD\s*(410|420|421|500|620)/i,
    vendor: 'zebra',
    model: 'ZD Series',
    driver: 'zpl',
    dpi: 203,
    maxWidthMm: 108,
    supportedBarcodes: ['code128', 'code39', 'ean13', 'ean8', 'upca', 'qr'],
  },
  {
    pattern: /Zebra\s*(GK|GX)\s*420/i,
    vendor: 'zebra',
    model: 'GK/GX 420',
    driver: 'zpl',
    dpi: 203,
    maxWidthMm: 108,
    supportedBarcodes: ['code128', 'code39', 'ean13', 'ean8', 'upca', 'qr'],
  },
  {
    pattern: /Zebra\s*ZT\s*(230|410|510|610)/i,
    vendor: 'zebra',
    model: 'ZT Industrial',
    driver: 'zpl',
    dpi: 203,
    maxWidthMm: 108,
    supportedBarcodes: ['code128', 'code39', 'ean13', 'ean8', 'upca', 'qr'],
  },
  // Legacy Zebra (EPL2)
  {
    pattern: /Zebra\s*(LP|TLP)\s*2824/i,
    vendor: 'zebra',
    model: 'LP/TLP 2824',
    driver: 'epl2',
    dpi: 203,
    maxWidthMm: 54,
    supportedBarcodes: ['code128', 'code39', 'ean13', 'ean8', 'upca'],
  },
  {
    pattern: /Zebra\s*TLP\s*2844/i,
    vendor: 'zebra',
    model: 'TLP 2844',
    driver: 'epl2',
    dpi: 203,
    maxWidthMm: 108,
    supportedBarcodes: ['code128', 'code39', 'ean13', 'ean8', 'upca'],
  },
  {
    pattern: /\bZebra\b/i,
    vendor: 'zebra',
    model: 'Generic Zebra',
    driver: 'zpl',
    dpi: 203,
    maxWidthMm: 108,
    supportedBarcodes: ['code128', 'code39', 'ean13', 'ean8', 'upca', 'qr'],
  },

  // ─── Xprinter (very common Chinese TSPL clone) ────────────────────
  {
    pattern: /Xprinter\s*XP[\s\-]*(365|370|420|460|470)/i,
    vendor: 'xprinter',
    model: 'XP Series',
    driver: 'tspl',
    dpi: 203,
    maxWidthMm: 108,
    supportedBarcodes: ['code128', 'code39', 'ean13', 'ean8', 'upca', 'qr'],
  },
  {
    pattern: /Xprinter/i,
    vendor: 'xprinter',
    model: 'Generic Xprinter',
    driver: 'tspl',
    dpi: 203,
    maxWidthMm: 108,
    supportedBarcodes: ['code128', 'code39', 'ean13', 'ean8', 'upca', 'qr'],
  },

  // ─── Godex ─────────────────────────────────────────────────────────
  {
    pattern: /Godex\s*G\s*500/i,
    vendor: 'godex',
    model: 'G500',
    driver: 'tspl',
    dpi: 203,
    maxWidthMm: 108,
    supportedBarcodes: ['code128', 'code39', 'ean13', 'ean8', 'upca', 'qr'],
  },
  {
    pattern: /Godex/i,
    vendor: 'godex',
    model: 'Generic Godex',
    driver: 'tspl',
    dpi: 203,
    maxWidthMm: 108,
    supportedBarcodes: ['code128', 'code39', 'ean13', 'ean8', 'upca', 'qr'],
  },

  // ─── Zenpert, Rongta, Munbyn (TSPL clones) ────────────────────────
  {
    pattern: /Zenpert\s*4T\d+/i,
    vendor: 'zenpert',
    model: '4T Series',
    driver: 'tspl',
    dpi: 203,
    maxWidthMm: 108,
    supportedBarcodes: ['code128', 'code39', 'ean13', 'ean8', 'upca', 'qr'],
  },
  {
    pattern: /Rongta\s*RP\d+/i,
    vendor: 'rongta',
    model: 'RP Series',
    driver: 'tspl',
    dpi: 203,
    maxWidthMm: 108,
    supportedBarcodes: ['code128', 'code39', 'ean13', 'ean8', 'upca', 'qr'],
  },
  {
    pattern: /Munbyn/i,
    vendor: 'munbyn',
    model: 'Generic Munbyn',
    driver: 'tspl',
    dpi: 203,
    maxWidthMm: 108,
    supportedBarcodes: ['code128', 'code39', 'ean13', 'ean8', 'upca', 'qr'],
  },

  // ─── Epson label models (ESC/POS label mode) ─────────────────────
  {
    pattern: /Epson\s*TM[\s\-]*L\s*90/i,
    vendor: 'epson',
    model: 'TM-L90',
    driver: 'escpos-label',
    dpi: 203,
    maxWidthMm: 80,
    supportedBarcodes: ['code128', 'code39', 'ean13', 'ean8', 'upca', 'qr'],
  },
  {
    pattern: /Epson\s*TM[\s\-]*L\s*100/i,
    vendor: 'epson',
    model: 'TM-L100',
    driver: 'escpos-label',
    dpi: 203,
    maxWidthMm: 80,
    supportedBarcodes: ['code128', 'code39', 'ean13', 'ean8', 'upca', 'qr'],
  },
  // ─── Bixolon SLP ──────────────────────────────────────────────────
  {
    pattern: /Bixolon\s*SLP[\s\-]*(TX403|TX420)/i,
    vendor: 'bixolon',
    model: 'SLP-TX Series',
    driver: 'escpos-label',
    dpi: 203,
    maxWidthMm: 108,
    supportedBarcodes: ['code128', 'code39', 'ean13', 'ean8', 'upca', 'qr'],
  },

  // ─── Honeywell (ZPL emulation) ────────────────────────────────────
  {
    pattern: /Honeywell\s*PC\s*42/i,
    vendor: 'honeywell',
    model: 'PC42',
    driver: 'zpl',
    dpi: 203,
    maxWidthMm: 108,
    supportedBarcodes: ['code128', 'code39', 'ean13', 'ean8', 'upca', 'qr'],
  },
];

/**
 * Try to identify a printer by its display name (typically the OS queue
 * name or a device description from a TCP probe).  Returns undefined when
 * nothing matches — the UI then prompts the user to pick a driver manually.
 */
export function identifyPrinter(displayName: string): VendorMatch | undefined {
  for (const entry of VENDOR_DATABASE) {
    if (entry.pattern.test(displayName)) {
      const { pattern, ...match } = entry;
      void pattern;
      return match;
    }
  }
  return undefined;
}
