import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { NotificationService } from '../../../core/services/notification.service';
import { PageHeaderComponent } from '../../../shared/page-header/page-header.component';
import {
  ApiResponse,
  DiscoveryResult,
  DriverName,
  PrinterConnection,
  PrinterProfile,
  TransportName,
} from './types';

/**
 * Discovery wizard — the "walk in and set it up" flow.
 *
 * Runs a parallel scan on the backend:
 *   1. Enumerate OS-installed printers (Windows Get-Printer / macOS lpstat /
 *      Linux ls /dev/usb/lp*)
 *   2. TCP scan the /24 for port 9100 listeners
 *
 * Shows results as cards. Each card has:
 *   - Detected name + transport + suggested driver
 *   - "Test Print" button that creates a temporary profile, fires a sample
 *     label, and deletes the temp profile
 *   - "Add" button that opens a lightweight inline form to confirm and save
 */
@Component({
  selector: 'app-printer-discovery',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PageHeaderComponent],
  template: `
    <div class="p-6 lg:p-8">
      <app-page-header
        title="Find Printers"
        subtitle="Automatically detect barcode printers on this machine and on your local network. Scanning takes 3-5 seconds."
      >
        <div class="flex items-center gap-2">
          <a
            routerLink="/settings/printers"
            class="px-4 py-2 text-sm font-semibold font-body bg-surface-container-highest/60 text-on-surface-variant hover:bg-primary-container/20 hover:text-primary rounded-lg transition-colors"
          >
            Back
          </a>
          <button
            (click)="scan()"
            [disabled]="scanning"
            class="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold font-body bg-gradient-cta text-white rounded-lg hover:shadow-glow-sm transition-all disabled:opacity-60"
          >
            @if (scanning) {
              <div class="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"></div>
            } @else {
              <span class="material-symbols-outlined text-lg">refresh</span>
            }
            {{ scanning ? 'Scanning...' : 'Scan Again' }}
          </button>
        </div>
      </app-page-header>

      @if (scanning && !result) {
        <div class="bg-surface-container rounded-xl p-12 text-center">
          <div class="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto mb-4"></div>
          <p class="text-sm font-body text-on-surface-variant">Searching for printers...</p>
          <p class="text-[10px] font-mono text-on-surface-variant/60 mt-2">Scanning OS-installed printers + TCP port 9100 on /24</p>
        </div>
      }

      @if (result) {
        <!-- OS-installed printers -->
        <div class="bg-surface-container rounded-xl overflow-hidden mb-4">
          <div class="px-5 py-3 border-b border-outline-variant/10 flex items-center gap-3">
            <span class="material-symbols-outlined text-lg text-primary">laptop</span>
            <h3 class="text-sm font-headline font-bold text-on-surface">OS-Installed Printers</h3>
            <span class="text-xs font-mono text-on-surface-variant/60">{{ result.osPrinters.length }} found</span>
          </div>

          @if (result.osPrinters.length === 0) {
            <div class="px-5 py-8 text-center text-xs font-body text-on-surface-variant/60">
              No printers found installed on this machine.
            </div>
          } @else {
            <div class="divide-y divide-outline-variant/10">
              @for (p of result.osPrinters; track p.displayName) {
                <div class="px-5 py-4 flex items-start gap-4">
                  <div class="flex items-center justify-center w-10 h-10 rounded-lg bg-primary-container/20 shrink-0">
                    <span class="material-symbols-outlined text-xl text-primary">print</span>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-body font-semibold text-on-surface truncate">{{ p.displayName }}</p>
                    <p class="text-xs font-mono text-on-surface-variant/80 mt-0.5">{{ p.transport }}</p>
                    @if (p.suggestion) {
                      <p class="text-[11px] font-body text-primary mt-1">
                        Detected: <strong>{{ p.suggestion.vendor }} {{ p.suggestion.model }}</strong>
                        &middot; {{ p.suggestion.driver.toUpperCase() }} driver
                      </p>
                    } @else {
                      <p class="text-[11px] font-body text-on-surface-variant/60 mt-1">
                        No automatic match — will default to PDF driver. You can change it after adding.
                      </p>
                    }
                  </div>
                  <button
                    (click)="addOsPrinter(p)"
                    [disabled]="addingIdx === 'os-' + p.displayName"
                    class="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold font-body bg-gradient-cta text-white rounded-lg hover:shadow-glow-sm transition-all disabled:opacity-60 shrink-0"
                  >
                    @if (addingIdx === 'os-' + p.displayName) {
                      <div class="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin"></div>
                    } @else {
                      <span class="material-symbols-outlined text-base">add</span>
                    }
                    Add
                  </button>
                </div>
              }
            </div>
          }
        </div>

        <!-- Network printers -->
        <div class="bg-surface-container rounded-xl overflow-hidden">
          <div class="px-5 py-3 border-b border-outline-variant/10 flex items-center gap-3">
            <span class="material-symbols-outlined text-lg text-primary">lan</span>
            <h3 class="text-sm font-headline font-bold text-on-surface">Network Printers</h3>
            <span class="text-xs font-mono text-on-surface-variant/60">{{ result.networkPrinters.length }} found on port 9100</span>
          </div>

          @if (result.networkPrinters.length === 0) {
            <div class="px-5 py-8 text-center text-xs font-body text-on-surface-variant/60">
              No printers responding on TCP port 9100 in your subnet.
            </div>
          } @else {
            <div class="divide-y divide-outline-variant/10">
              @for (p of result.networkPrinters; track p.host) {
                <div class="px-5 py-4 flex items-start gap-4">
                  <div class="flex items-center justify-center w-10 h-10 rounded-lg bg-primary-container/20 shrink-0">
                    <span class="material-symbols-outlined text-xl text-primary">router</span>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-mono font-semibold text-on-surface">{{ p.host }}:{{ p.port }}</p>
                    <p class="text-[11px] font-body text-on-surface-variant/60 mt-1">
                      Pick the command language on the next screen. TSPL is the right choice for most TVS/TSC/Xprinter/Godex models.
                    </p>
                  </div>
                  <button
                    (click)="addNetworkPrinter(p.host, p.port)"
                    [disabled]="addingIdx === 'net-' + p.host"
                    class="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold font-body bg-gradient-cta text-white rounded-lg hover:shadow-glow-sm transition-all disabled:opacity-60 shrink-0"
                  >
                    @if (addingIdx === 'net-' + p.host) {
                      <div class="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin"></div>
                    } @else {
                      <span class="material-symbols-outlined text-base">add</span>
                    }
                    Add
                  </button>
                </div>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class PrinterDiscoveryComponent implements OnInit {
  result: DiscoveryResult | null = null;
  scanning = false;
  addingIdx: string | null = null;

  constructor(
    private api: ApiService,
    private router: Router,
    private notification: NotificationService
  ) {}

  ngOnInit(): void {
    this.scan();
  }

  scan(): void {
    this.scanning = true;
    this.api.get<ApiResponse<DiscoveryResult>>('/printing/discover').subscribe({
      next: (res) => {
        this.result = res.data;
        this.scanning = false;
      },
      error: () => {
        this.scanning = false;
        this.notification.error('Scan failed — make sure you have permission to enumerate printers on this machine.');
      },
    });
  }

  addOsPrinter(p: DiscoveryResult['osPrinters'][number]): void {
    this.addingIdx = 'os-' + p.displayName;
    const driver: DriverName = p.suggestion?.driver ?? 'pdf';
    const body = {
      name: p.suggestion ? `${p.suggestion.vendor} ${p.suggestion.model}` : p.displayName,
      vendor: p.suggestion?.vendor ?? 'generic',
      model: p.suggestion?.model ?? null,
      driver,
      transport: p.transport as TransportName,
      connection: p.connection as PrinterConnection,
      dpi: p.suggestion?.dpi ?? 203,
      maxWidthMm: p.suggestion?.maxWidthMm ?? 108,
      capabilities: p.suggestion
        ? { supportedBarcodes: p.suggestion.supportedBarcodes }
        : {},
      isDefault: false,
    };
    this.api.post<ApiResponse<PrinterProfile>>('/printing/profiles', body).subscribe({
      next: (res) => {
        this.addingIdx = null;
        this.notification.success(`Added ${res.data.name}`);
        this.router.navigate(['/settings/printers', res.data.id, 'edit']);
      },
      error: () => (this.addingIdx = null),
    });
  }

  addNetworkPrinter(host: string, port: number): void {
    this.addingIdx = 'net-' + host;
    const body = {
      name: `Network printer ${host}`,
      vendor: 'generic',
      driver: 'tspl' as DriverName, // good default for most Indian retail printers
      transport: 'tcp' as TransportName,
      connection: { host, port },
      dpi: 203,
      maxWidthMm: 108,
      capabilities: {
        supportedBarcodes: ['code128', 'code39', 'ean13', 'ean8', 'upca', 'qr'],
      },
      isDefault: false,
    };
    this.api.post<ApiResponse<PrinterProfile>>('/printing/profiles', body).subscribe({
      next: (res) => {
        this.addingIdx = null;
        this.notification.success(`Added printer ${host}`);
        this.router.navigate(['/settings/printers', res.data.id, 'edit']);
      },
      error: () => (this.addingIdx = null),
    });
  }
}
