/**
 * Shared TypeScript types for the printing settings UI.
 *
 * These mirror the backend DTOs in `backend/src/modules/printing/`.
 * Keep in sync — changes on the backend IR must be reflected here.
 */

export type DriverName = 'tspl' | 'zpl' | 'epl2' | 'escpos-label' | 'pdf';
export type TransportName = 'tcp' | 'usb-lp' | 'cups' | 'win-spool' | 'browser';
export type BarcodeType = 'code128' | 'code39' | 'ean13' | 'ean8' | 'upca' | 'qr';

export interface PrinterConnection {
  host?: string;
  port?: number;
  devicePath?: string;
  queueName?: string;
}

export interface PrinterProfile {
  id: number;
  branchId: number;
  name: string;
  vendor: string;
  model: string | null;
  driver: DriverName;
  transport: TransportName;
  connection: PrinterConnection;
  dpi: number;
  maxWidthMm: number;
  capabilities: {
    supportedBarcodes?: BarcodeType[];
    [key: string]: unknown;
  };
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  templates?: { id: number; name: string; isDefault: boolean; widthMm: number; heightMm: number }[];
}

export interface DriverDescriptor {
  name: DriverName;
  displayName: string;
  capabilities: {
    supportedBarcodes: BarcodeType[];
    unicode: boolean;
    nativeBold: boolean;
    densityRange: [number, number];
    speedRange: [number, number];
  };
}

export interface TransportDescriptor {
  name: TransportName;
  displayName: string;
  supported: boolean;
}

export interface DiscoveryResult {
  osPrinters: Array<{
    displayName: string;
    transport: 'win-spool' | 'cups' | 'usb-lp';
    connection: PrinterConnection;
    suggestion?: {
      vendor: string;
      model: string;
      driver: DriverName;
      dpi: number;
      maxWidthMm: number;
      supportedBarcodes: BarcodeType[];
    };
  }>;
  networkPrinters: Array<{
    host: string;
    port: number;
    hostname?: string;
    suggestion?: unknown;
  }>;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}
