import { Injectable } from '@angular/core';

/**
 * Pairs the browser with a USB label printer once via the WebUSB chooser
 * dialog, then streams raw printer-language bytes (TSPL/ZPL/EPL2/ESC-POS)
 * straight to the printer's bulk OUT endpoint — no print dialog, no native
 * helper, no driver round-trip.
 *
 * Constraints:
 * - Chrome / Edge desktop only. Firefox and Safari do not implement WebUSB.
 * - Page must be served from a secure context (HTTPS or localhost).
 * - On Windows the OS print spooler holds the USB device by default; the
 *   user must replace the printer's driver with WinUSB once via Zadig
 *   (https://zadig.akeo.ie/) before WebUSB can claim the interface.
 *
 * The paired device's vendorId/productId/serialNumber is persisted to
 * localStorage so subsequent prints can re-locate it via getDevices()
 * without showing the chooser again.
 */

const STORAGE_KEY = 'amir-pos.usb-printer.identity';

interface StoredIdentity {
  vendorId: number;
  productId: number;
  serialNumber?: string;
}

@Injectable({ providedIn: 'root' })
export class UsbPrinterService {
  isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'usb' in navigator;
  }

  /** Returns the previously-paired device if Chrome still remembers it. No prompt. */
  async getPairedDevice(): Promise<USBDevice | null> {
    if (!this.isSupported()) return null;
    const stored = this.loadIdentity();
    if (!stored) return null;
    const all = await navigator.usb.getDevices();
    return (
      all.find(
        (d) =>
          d.vendorId === stored.vendorId &&
          d.productId === stored.productId &&
          (!stored.serialNumber || d.serialNumber === stored.serialNumber)
      ) ?? null
    );
  }

  /**
   * Show the OS USB device chooser. Must be called from a user gesture
   * (e.g. inside a click handler). Persists the chosen device's identity
   * so future prints don't prompt.
   */
  async requestDevice(filters: USBDeviceFilter[] = []): Promise<USBDevice> {
    if (!this.isSupported()) {
      throw new Error(
        'WebUSB is not available in this browser. Use Chrome or Edge on desktop.'
      );
    }
    const device = await navigator.usb.requestDevice({ filters });
    this.saveIdentity({
      vendorId: device.vendorId,
      productId: device.productId,
      serialNumber: device.serialNumber,
    });
    return device;
  }

  forget(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // localStorage unavailable (private mode etc.) — silent.
    }
  }

  /**
   * Send raw bytes to the device's first bulk OUT endpoint. Opens, claims,
   * transfers, and releases. Caller does not need to manage device state.
   */
  async sendRaw(device: USBDevice, bytes: Uint8Array): Promise<void> {
    if (!device.opened) {
      try {
        await device.open();
      } catch (e: any) {
        const msg = e?.message || String(e);
        throw new Error(
          `Could not open USB printer (${msg}). On Windows the OS printer driver is probably holding the device — replace it with WinUSB once using Zadig (https://zadig.akeo.ie/), then retry.`
        );
      }
    }
    if (!device.configuration) {
      await device.selectConfiguration(1);
    }
    const cfg = device.configuration;
    if (!cfg) {
      throw new Error('USB device has no active configuration.');
    }

    let target: { ifaceNumber: number; endpointNumber: number } | null = null;
    for (const iface of cfg.interfaces) {
      const out = iface.alternate.endpoints.find(
        (e) => e.direction === 'out' && e.type === 'bulk'
      );
      if (out) {
        target = { ifaceNumber: iface.interfaceNumber, endpointNumber: out.endpointNumber };
        break;
      }
    }
    if (!target) {
      throw new Error(
        'No bulk OUT endpoint found on this USB device — does not appear to be a printer.'
      );
    }

    await device.claimInterface(target.ifaceNumber);
    try {
      // Chunk so the WebUSB layer doesn't choke on multi-MB receipts.
      const CHUNK = 65536;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
        const res = await device.transferOut(target.endpointNumber, slice);
        if (res.status !== 'ok') {
          throw new Error(`USB transfer failed with status '${res.status}'.`);
        }
      }
    } finally {
      try {
        await device.releaseInterface(target.ifaceNumber);
      } catch {
        // Release errors aren't fatal — device will be released on close.
      }
    }
  }

  private loadIdentity(): StoredIdentity | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as StoredIdentity) : null;
    } catch {
      return null;
    }
  }

  private saveIdentity(id: StoredIdentity): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(id));
    } catch {
      // localStorage unavailable — skip persistence; user will re-pair next session.
    }
  }
}
