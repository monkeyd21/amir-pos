import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/services/api.service';
import { UsbPrinterService } from './usb-printer.service';

/**
 * Single entry point for label printing from the frontend.
 *
 * The backend's `/printing/print` endpoint either prints server-side
 * (TCP / CUPS / win-spool / usb-lp) or — for the `browser` transport —
 * returns the rendered label bytes as base64 in `browserPayload`. This
 * service hides that branching from callers:
 *
 *  - Server-side transport → POST returns, show success.
 *  - browser + raw printer language (TSPL/ZPL/EPL2/octet-stream) →
 *    stream the bytes straight to the paired USB device via WebUSB
 *    (silent print, no OS dialog).
 *  - browser + PDF → drop into a hidden iframe and trigger window.print()
 *    (used as a last-resort fallback for printers that aren't paired
 *    over WebUSB; will show the OS print dialog).
 */

export interface LabelItem {
  sku: string;
  productName?: string;
  variantLabel?: string;
  price?: number;
  mrp?: number;
  lotCode?: string;
  copies?: number;
}

interface BrowserPayload {
  contentType: string;
  base64: string;
}

export interface LabelPrintResult {
  labelsPrinted: number;
  itemCount: number;
  transport: string;
  driver: string;
  browserPayload?: BrowserPayload;
}

interface PrintApiBody {
  items: LabelItem[];
  profileId?: number;
  templateId?: number;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

@Injectable({ providedIn: 'root' })
export class LabelPrintService {
  constructor(
    private api: ApiService,
    private usb: UsbPrinterService
  ) {}

  async print(
    items: LabelItem[],
    opts: { profileId?: number; templateId?: number } = {}
  ): Promise<LabelPrintResult> {
    const body: PrintApiBody = { items };
    if (opts.profileId) body.profileId = opts.profileId;
    if (opts.templateId) body.templateId = opts.templateId;

    const res = await firstValueFrom(
      this.api.post<ApiResponse<LabelPrintResult>>('/printing/print', body)
    );
    const data = res.data;
    if (data.browserPayload) {
      await this.handleBrowserPayload(data.browserPayload);
    }
    return data;
  }

  /**
   * Public so callers of other endpoints (e.g. the printer settings
   * test-print button hitting `/printing/profiles/:id/test`) can reuse
   * the same browser-side rendering path.
   */
  async handleBrowserPayload(payload: BrowserPayload): Promise<void> {
    const bytes = base64ToBytes(payload.base64);
    if (payload.contentType === 'application/pdf') {
      this.printPdfFallback(bytes);
      return;
    }
    await this.printOverUsb(bytes);
  }

  private async printOverUsb(bytes: Uint8Array): Promise<void> {
    if (!this.usb.isSupported()) {
      throw new Error(
        'Direct USB printing requires Chrome or Edge on desktop. Switch the printer profile to the PDF driver to fall back to browser-dialog printing.'
      );
    }
    let device = await this.usb.getPairedDevice();
    if (!device) {
      device = await this.usb.requestDevice();
    }
    await this.usb.sendRaw(device, bytes);
  }

  private printPdfFallback(bytes: Uint8Array): void {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.src = url;
    iframe.onload = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch {
        // Some browsers throw if print() fires before the PDF viewer is ready —
        // user can still print from the PDF that's now visible.
      }
      setTimeout(() => {
        URL.revokeObjectURL(url);
        iframe.remove();
      }, 60_000);
    };
    document.body.appendChild(iframe);
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
