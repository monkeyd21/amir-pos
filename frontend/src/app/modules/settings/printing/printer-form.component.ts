import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { NotificationService } from '../../../core/services/notification.service';
import { PageHeaderComponent } from '../../../shared/page-header/page-header.component';
import {
  ApiResponse,
  DriverDescriptor,
  DriverName,
  PrinterConnection,
  PrinterProfile,
  TransportDescriptor,
  TransportName,
} from './types';

/**
 * Form for creating or editing a printer profile manually. Shows only
 * the connection fields relevant to the chosen transport — TCP needs
 * host/port, usb-lp needs devicePath, cups/win-spool need queueName.
 *
 * Transports that aren't usable on the current OS are disabled in the
 * dropdown with a hint.
 */
@Component({
  selector: 'app-printer-form',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PageHeaderComponent],
  template: `
    <div class="p-6 lg:p-8 max-w-3xl">
      <app-page-header
        [title]="editingId ? 'Edit Printer' : 'Add Printer'"
        [subtitle]="editingId ? 'Update printer profile configuration' : 'Configure a new barcode label printer for this branch'"
      >
        <a
          routerLink="/settings/printers"
          class="px-4 py-2 text-sm font-semibold font-body bg-surface-container-highest/60 text-on-surface-variant hover:bg-primary-container/20 hover:text-primary rounded-lg transition-colors"
        >
          Cancel
        </a>
      </app-page-header>

      @if (loading) {
        <div class="flex items-center justify-center py-16">
          <div class="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></div>
        </div>
      } @else {
        <form (ngSubmit)="save()" class="bg-surface-container rounded-xl p-6 space-y-5">

          <!-- Identity -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label class="flex flex-col gap-1.5 md:col-span-2">
              <span class="text-xs font-semibold font-body text-on-surface-variant">Display Name</span>
              <input type="text" [(ngModel)]="profile.name" name="name" required placeholder="e.g. Front Counter TVS"
                class="px-3 py-2 text-sm font-body bg-surface-container-high text-on-surface border border-outline-variant/20 rounded-lg focus:border-primary focus:outline-none" />
            </label>
            <label class="flex flex-col gap-1.5">
              <span class="text-xs font-semibold font-body text-on-surface-variant">Vendor</span>
              <input type="text" [(ngModel)]="profile.vendor" name="vendor" placeholder="tvs, zebra, tsc..."
                class="px-3 py-2 text-sm font-body bg-surface-container-high text-on-surface border border-outline-variant/20 rounded-lg focus:border-primary focus:outline-none" />
            </label>
            <label class="flex flex-col gap-1.5">
              <span class="text-xs font-semibold font-body text-on-surface-variant">Model</span>
              <input type="text" [(ngModel)]="profile.model" name="model" placeholder="e.g. LP 46 Neo"
                class="px-3 py-2 text-sm font-body bg-surface-container-high text-on-surface border border-outline-variant/20 rounded-lg focus:border-primary focus:outline-none" />
            </label>
          </div>

          <div class="h-px bg-outline-variant/10"></div>

          <!-- Driver -->
          <label class="flex flex-col gap-1.5">
            <span class="text-xs font-semibold font-body text-on-surface-variant">Command Language (Driver)</span>
            <select [(ngModel)]="profile.driver" name="driver" (change)="onDriverChange()" required
              class="px-3 py-2 text-sm font-body bg-surface-container-high text-on-surface border border-outline-variant/20 rounded-lg focus:border-primary focus:outline-none">
              @for (d of drivers; track d.name) {
                <option [ngValue]="d.name">{{ d.displayName }}</option>
              }
            </select>
            @if (activeDriver) {
              <p class="text-[10px] font-mono text-on-surface-variant/60 mt-0.5">
                Barcodes: {{ activeDriver.capabilities.supportedBarcodes.join(', ') }}
              </p>
            }
          </label>

          <!-- Transport -->
          <label class="flex flex-col gap-1.5">
            <span class="text-xs font-semibold font-body text-on-surface-variant">Connection Type (Transport)</span>
            <select [(ngModel)]="profile.transport" name="transport" (change)="onTransportChange()" required
              class="px-3 py-2 text-sm font-body bg-surface-container-high text-on-surface border border-outline-variant/20 rounded-lg focus:border-primary focus:outline-none">
              @for (t of transports; track t.name) {
                <option [ngValue]="t.name" [disabled]="!t.supported">
                  {{ t.displayName }}{{ !t.supported ? ' (not supported on this OS)' : '' }}
                </option>
              }
            </select>
          </label>

          <!-- Connection-specific fields -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 bg-surface-container-high/30 rounded-lg p-4 border border-outline-variant/10">
            @if (profile.transport === 'tcp') {
              <label class="flex flex-col gap-1.5 md:col-span-2">
                <span class="text-xs font-semibold font-body text-on-surface-variant">Printer IP or Hostname</span>
                <input type="text" [(ngModel)]="connection.host" name="host" placeholder="192.168.1.200"
                  class="px-3 py-2 text-sm font-mono bg-surface-container-lowest text-on-surface border border-outline-variant/20 rounded-lg focus:border-primary focus:outline-none" />
              </label>
              <label class="flex flex-col gap-1.5">
                <span class="text-xs font-semibold font-body text-on-surface-variant">Port</span>
                <input type="number" [(ngModel)]="connection.port" name="port" placeholder="9100"
                  class="px-3 py-2 text-sm font-mono bg-surface-container-lowest text-on-surface border border-outline-variant/20 rounded-lg focus:border-primary focus:outline-none" />
              </label>
            }
            @if (profile.transport === 'usb-lp') {
              <label class="flex flex-col gap-1.5 md:col-span-2">
                <span class="text-xs font-semibold font-body text-on-surface-variant">Device Path</span>
                <input type="text" [(ngModel)]="connection.devicePath" name="devicePath" placeholder="/dev/usb/lp0"
                  class="px-3 py-2 text-sm font-mono bg-surface-container-lowest text-on-surface border border-outline-variant/20 rounded-lg focus:border-primary focus:outline-none" />
                <p class="text-[10px] text-on-surface-variant/60 mt-0.5">
                  Linux-only. The user running the backend must be a member of the <code>lp</code> group.
                </p>
              </label>
            }
            @if (profile.transport === 'cups' || profile.transport === 'win-spool') {
              <label class="flex flex-col gap-1.5 md:col-span-2">
                <span class="text-xs font-semibold font-body text-on-surface-variant">Printer Queue Name</span>
                <input type="text" [(ngModel)]="connection.queueName" name="queueName" placeholder="Exact name from OS Printers list"
                  class="px-3 py-2 text-sm font-mono bg-surface-container-lowest text-on-surface border border-outline-variant/20 rounded-lg focus:border-primary focus:outline-none" />
                <p class="text-[10px] text-on-surface-variant/60 mt-0.5">
                  {{ profile.transport === 'win-spool' ? 'Match the name in Windows → Settings → Printers & Scanners.' : 'Use lpstat -a to list available CUPS queues.' }}
                </p>
              </label>
            }
            @if (profile.transport === 'browser') {
              <div class="md:col-span-2 text-xs font-body text-on-surface-variant">
                Browser transport returns the rendered label to the frontend as bytes. Your browser opens a print dialog and you pick the printer from there. No server-side connection needed — works on any OS.
              </div>
            }
          </div>

          <div class="h-px bg-outline-variant/10"></div>

          <!-- Hardware properties -->
          <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
            <label class="flex flex-col gap-1.5">
              <span class="text-xs font-semibold font-body text-on-surface-variant">DPI</span>
              <select [(ngModel)]="profile.dpi" name="dpi"
                class="px-3 py-2 text-sm font-mono bg-surface-container-high text-on-surface border border-outline-variant/20 rounded-lg focus:border-primary focus:outline-none">
                <option [ngValue]="203">203 DPI</option>
                <option [ngValue]="300">300 DPI</option>
                <option [ngValue]="600">600 DPI</option>
              </select>
            </label>
            <label class="flex flex-col gap-1.5">
              <span class="text-xs font-semibold font-body text-on-surface-variant">Max Width (mm)</span>
              <input type="number" [(ngModel)]="profile.maxWidthMm" name="maxWidthMm" min="20" max="500" step="1"
                class="px-3 py-2 text-sm font-mono bg-surface-container-high text-on-surface border border-outline-variant/20 rounded-lg focus:border-primary focus:outline-none" />
            </label>
            <label class="flex flex-col gap-1.5 col-span-2 md:col-span-1">
              <span class="text-xs font-semibold font-body text-on-surface-variant">Default for branch?</span>
              <div class="flex items-center h-10">
                <input type="checkbox" [(ngModel)]="profile.isDefault" name="isDefault"
                  class="w-5 h-5 rounded" />
              </div>
            </label>
          </div>

          <div class="flex items-center justify-end gap-2 pt-4 border-t border-outline-variant/10">
            @if (editingId) {
              <button type="button" (click)="test()" [disabled]="testing"
                class="px-4 py-2 text-sm font-semibold font-body bg-surface-container-high text-on-surface hover:bg-primary-container/20 hover:text-primary rounded-lg transition-colors">
                Test Print
              </button>
            }
            <button type="submit" [disabled]="saving"
              class="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold font-body bg-gradient-cta text-white rounded-lg hover:shadow-glow-sm transition-all disabled:opacity-60">
              @if (saving) {
                <div class="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"></div>
              }
              {{ editingId ? 'Save Changes' : 'Add Printer' }}
            </button>
          </div>
        </form>
      }
    </div>
  `,
})
export class PrinterFormComponent implements OnInit {
  editingId: number | null = null;
  loading = false;
  saving = false;
  testing = false;

  drivers: DriverDescriptor[] = [];
  transports: TransportDescriptor[] = [];

  profile: {
    name: string;
    vendor: string;
    model: string | null;
    driver: DriverName;
    transport: TransportName;
    dpi: number;
    maxWidthMm: number;
    isDefault: boolean;
  } = {
    name: '',
    vendor: 'generic',
    model: '',
    driver: 'tspl',
    transport: 'tcp',
    dpi: 203,
    maxWidthMm: 108,
    isDefault: false,
  };

  connection: PrinterConnection = {};

  constructor(
    private api: ApiService,
    private route: ActivatedRoute,
    private router: Router,
    private notification: NotificationService
  ) {}

  ngOnInit(): void {
    const idParam = this.route.snapshot.paramMap.get('id');
    this.editingId = idParam ? Number(idParam) : null;
    this.bootstrap();
  }

  private async bootstrap(): Promise<void> {
    this.loading = true;
    try {
      await Promise.all([this.loadDrivers(), this.loadTransports()]);
      if (this.editingId) {
        await this.loadProfile(this.editingId);
      }
    } finally {
      this.loading = false;
    }
  }

  private loadDrivers(): Promise<void> {
    return new Promise((resolve) => {
      this.api.get<ApiResponse<DriverDescriptor[]>>('/printing/drivers').subscribe({
        next: (res) => {
          this.drivers = res.data;
          resolve();
        },
        error: () => resolve(),
      });
    });
  }

  private loadTransports(): Promise<void> {
    return new Promise((resolve) => {
      this.api.get<ApiResponse<TransportDescriptor[]>>('/printing/transports').subscribe({
        next: (res) => {
          this.transports = res.data;
          resolve();
        },
        error: () => resolve(),
      });
    });
  }

  private loadProfile(id: number): Promise<void> {
    return new Promise((resolve) => {
      this.api.get<ApiResponse<PrinterProfile>>(`/printing/profiles/${id}`).subscribe({
        next: (res) => {
          const p = res.data;
          this.profile = {
            name: p.name,
            vendor: p.vendor,
            model: p.model,
            driver: p.driver,
            transport: p.transport,
            dpi: p.dpi,
            maxWidthMm: p.maxWidthMm,
            isDefault: p.isDefault,
          };
          this.connection = p.connection ?? {};
          resolve();
        },
        error: () => resolve(),
      });
    });
  }

  get activeDriver(): DriverDescriptor | undefined {
    return this.drivers.find((d) => d.name === this.profile.driver);
  }

  onDriverChange(): void {
    // When switching to PDF, suggest 'cups' or 'win-spool' since that's how
    // you print a PDF on a real device. But don't force — user can override.
    if (this.profile.driver === 'pdf') {
      const preferred = this.transports.find((t) => (t.name === 'win-spool' || t.name === 'cups') && t.supported);
      if (preferred) this.profile.transport = preferred.name;
    }
  }

  onTransportChange(): void {
    // Reset connection fields that aren't applicable to the new transport
    this.connection = {};
  }

  save(): void {
    if (this.saving) return;
    this.saving = true;
    const body = { ...this.profile, connection: this.connection };
    const req = this.editingId
      ? this.api.put<ApiResponse<PrinterProfile>>(`/printing/profiles/${this.editingId}`, body)
      : this.api.post<ApiResponse<PrinterProfile>>('/printing/profiles', body);
    req.subscribe({
      next: () => {
        this.saving = false;
        this.notification.success(this.editingId ? 'Printer updated' : 'Printer created');
        this.router.navigate(['/settings/printers']);
      },
      error: () => (this.saving = false),
    });
  }

  test(): void {
    if (!this.editingId || this.testing) return;
    this.testing = true;
    this.api
      .post<ApiResponse<unknown>>(`/printing/profiles/${this.editingId}/test`, {})
      .subscribe({
        next: () => {
          this.notification.success('Test label sent');
          this.testing = false;
        },
        error: () => (this.testing = false),
      });
  }
}
