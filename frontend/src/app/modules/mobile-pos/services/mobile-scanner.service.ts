import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import {
  BarcodeScanner,
  BarcodeFormat,
} from '@capacitor-mlkit/barcode-scanning';

export interface ScanResult {
  /** null = scan cancelled or no result */
  code: string | null;
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class MobileScannerService {
  private moduleReadyPromise: Promise<boolean> | null = null;

  /** Called once on app boot. Ensures ML Kit scanner module is installed. */
  async prepare(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false;
    if (this.moduleReadyPromise) return this.moduleReadyPromise;

    this.moduleReadyPromise = (async () => {
      try {
        const { supported } = await BarcodeScanner.isSupported();
        if (!supported) return false;
        const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
        if (!available) {
          await BarcodeScanner.installGoogleBarcodeScannerModule();
        }
        return true;
      } catch {
        return false;
      }
    })();
    return this.moduleReadyPromise;
  }

  /** Prompt for camera permission if needed. Returns true if granted. */
  async requestPermission(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return true;
    try {
      const { camera } = await BarcodeScanner.requestPermissions();
      return camera === 'granted' || camera === 'limited';
    } catch {
      return false;
    }
  }

  async scan(): Promise<ScanResult> {
    if (!Capacitor.isNativePlatform()) {
      // Web fallback: use prompt so the flow is still testable in a browser.
      const code = typeof window !== 'undefined' ? window.prompt('Enter barcode:') : null;
      return { code: code?.trim() || null };
    }

    try {
      await this.prepare();
      const granted = await this.requestPermission();
      if (!granted) {
        return { code: null, error: 'Camera permission denied' };
      }

      const result = await BarcodeScanner.scan({
        formats: [
          BarcodeFormat.Code128,
          BarcodeFormat.Code39,
          BarcodeFormat.Ean13,
          BarcodeFormat.Ean8,
          BarcodeFormat.UpcA,
          BarcodeFormat.QrCode,
        ],
      });

      const code = result.barcodes[0]?.rawValue;
      return { code: code || null };
    } catch (err: any) {
      return { code: null, error: err?.message || 'Scan failed' };
    }
  }
}
