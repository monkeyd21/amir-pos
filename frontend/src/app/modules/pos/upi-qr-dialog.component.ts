import { Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../core/services/api.service';

type PaymentStatus = 'pending' | 'completed' | 'failed' | 'expired';

interface StatusResponse {
  success: boolean;
  data: {
    status: PaymentStatus;
    saleNumber?: string;
    saleId?: number;
  };
}

@Component({
  selector: 'app-upi-qr-dialog',
  standalone: true,
  imports: [CommonModule],
  template: `
    <!-- Overlay Backdrop -->
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      (click)="onBackdropClick($event)"
    >
      <!-- Dialog Panel -->
      <div class="w-full max-w-md mx-4 bg-surface-container border border-outline-variant/20 rounded-2xl shadow-ambient overflow-hidden">
        <!-- Header -->
        <div class="flex items-center justify-between px-6 py-5 border-b border-outline-variant/10">
          <div class="flex items-center gap-3">
            <button
              (click)="onCancel()"
              class="p-1.5 rounded-lg hover:bg-surface-container-high/60 transition-colors cursor-pointer"
            >
              <span class="material-symbols-outlined text-lg text-on-surface-variant">arrow_back</span>
            </button>
            <h2 class="text-lg font-headline font-bold text-on-surface tracking-tight">Pay via UPI</h2>
          </div>
          <div class="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10">
            <span class="material-symbols-outlined text-xl text-primary">qr_code_2</span>
          </div>
        </div>

        <!-- Body -->
        <div class="px-6 py-6">

          <!-- Pending State -->
          @if (status === 'pending') {
            <div class="flex flex-col items-center">
              <!-- QR Code -->
              @if (qrCodeUrl) {
                <div class="p-3 bg-white rounded-2xl shadow-sm mb-5">
                  <img
                    [src]="qrCodeUrl"
                    alt="UPI QR Code"
                    class="w-[220px] h-[220px] object-contain"
                  />
                </div>
              } @else if (upiLink) {
                <!-- Fallback: copyable UPI link -->
                <div class="w-full mb-5 p-4 bg-surface-container-high/60 border border-outline-variant/20 rounded-xl">
                  <p class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-2">UPI Link</p>
                  <div class="flex items-center gap-2">
                    <code class="flex-1 text-xs font-body text-on-surface break-all select-all">{{ upiLink }}</code>
                    <button
                      (click)="copyUpiLink()"
                      class="shrink-0 p-2 rounded-lg hover:bg-surface-container-high transition-colors cursor-pointer"
                      [title]="copied ? 'Copied!' : 'Copy link'"
                    >
                      <span class="material-symbols-outlined text-base text-primary">
                        {{ copied ? 'check' : 'content_copy' }}
                      </span>
                    </button>
                  </div>
                </div>
              }

              <!-- Amount -->
              <p class="text-2xl font-headline font-bold text-on-surface tracking-tight mb-1">
                {{ formatCurrency(amount) }}
              </p>
              <p class="text-sm font-body text-on-surface-variant mb-4">
                Scan with any UPI app
              </p>

              <!-- Countdown -->
              @if (remainingSeconds > 0) {
                <div class="flex items-center gap-1.5 text-sm font-body text-on-surface-variant mb-4">
                  <span class="material-symbols-outlined text-base">timer</span>
                  <span>Expires in {{ formattedCountdown }}</span>
                </div>
              }

              <!-- Waiting indicator -->
              <div class="flex items-center gap-2 text-sm font-body text-on-surface-variant">
                <span class="relative flex h-2.5 w-2.5">
                  <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/60"></span>
                  <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary"></span>
                </span>
                <span>Waiting for payment...</span>
              </div>
            </div>
          }

          <!-- Completed State -->
          @if (status === 'completed') {
            <div class="flex flex-col items-center py-4">
              <div class="flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/10 mb-4">
                <span class="material-symbols-outlined text-4xl text-emerald-400">check_circle</span>
              </div>
              <p class="text-xl font-headline font-bold text-on-surface mb-1">Payment Received!</p>
              <p class="text-lg font-headline font-bold text-emerald-400 mb-2">
                {{ formatCurrency(amount) }}
              </p>
              @if (saleNumber) {
                <p class="text-sm font-body text-on-surface-variant">
                  Sale: {{ saleNumber }}
                </p>
              }
            </div>
          }

          <!-- Failed State -->
          @if (status === 'failed') {
            <div class="flex flex-col items-center py-4">
              <div class="flex items-center justify-center w-16 h-16 rounded-full bg-red-500/10 mb-4">
                <span class="material-symbols-outlined text-4xl text-red-400">cancel</span>
              </div>
              <p class="text-xl font-headline font-bold text-on-surface mb-1">Payment Failed</p>
              <p class="text-sm font-body text-on-surface-variant mb-5">
                The payment could not be completed.
              </p>
              <button
                (click)="onCancel()"
                class="px-5 py-2.5 text-sm font-semibold font-body bg-primary text-on-primary rounded-xl hover:bg-primary/90 transition-colors cursor-pointer"
              >
                Try Again
              </button>
            </div>
          }

          <!-- Expired State -->
          @if (status === 'expired') {
            <div class="flex flex-col items-center py-4">
              <div class="flex items-center justify-center w-16 h-16 rounded-full bg-amber-500/10 mb-4">
                <span class="material-symbols-outlined text-4xl text-amber-400">schedule</span>
              </div>
              <p class="text-xl font-headline font-bold text-on-surface mb-1">QR Code Expired</p>
              <p class="text-sm font-body text-on-surface-variant mb-5">
                The payment window has closed.
              </p>
              <button
                (click)="onCancel()"
                class="px-5 py-2.5 text-sm font-semibold font-body bg-primary text-on-primary rounded-xl hover:bg-primary/90 transition-colors cursor-pointer"
              >
                Try Again
              </button>
            </div>
          }

        </div>

        <!-- Footer (only show cancel in pending state) -->
        @if (status === 'pending') {
          <div class="flex items-center justify-center px-6 py-4 border-t border-outline-variant/10 bg-surface-container-low/40">
            <button
              (click)="onCancel()"
              class="px-5 py-2.5 text-sm font-medium font-body text-on-surface-variant rounded-lg hover:bg-surface-container-high/60 transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        }
      </div>
    </div>
  `,
})
export class UpiQrDialogComponent implements OnInit, OnDestroy {
  @Input() intentId = '';
  @Input() qrCodeUrl = '';
  @Input() upiLink = '';
  @Input() amount = 0;
  @Input() expiresAt = '';

  @Output() paymentComplete = new EventEmitter<{ saleNumber: string; saleId: number }>();
  @Output() cancelled = new EventEmitter<void>();

  status: PaymentStatus = 'pending';
  saleNumber = '';
  saleId = 0;
  remainingSeconds = 0;
  copied = false;

  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private countdownInterval: ReturnType<typeof setInterval> | null = null;
  private autoEmitTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.startCountdown();
    this.startPolling();
  }

  ngOnDestroy(): void {
    this.cleanup();
  }

  get formattedCountdown(): string {
    const mins = Math.floor(this.remainingSeconds / 60);
    const secs = this.remainingSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value || 0);
  }

  copyUpiLink(): void {
    if (!this.upiLink) return;
    navigator.clipboard.writeText(this.upiLink).then(() => {
      this.copied = true;
      setTimeout(() => (this.copied = false), 2000);
    });
  }

  onBackdropClick(event: Event): void {
    if (event.target === event.currentTarget && this.status === 'pending') {
      this.onCancel();
    }
  }

  onCancel(): void {
    this.cleanup();
    this.cancelled.emit();
  }

  private startCountdown(): void {
    if (!this.expiresAt) return;

    const updateRemaining = () => {
      const now = Date.now();
      const expires = new Date(this.expiresAt).getTime();
      const diff = Math.max(0, Math.floor((expires - now) / 1000));
      this.remainingSeconds = diff;

      if (diff <= 0 && this.status === 'pending') {
        this.status = 'expired';
        this.stopPolling();
        this.stopCountdown();
      }
    };

    updateRemaining();
    this.countdownInterval = setInterval(updateRemaining, 1000);
  }

  private startPolling(): void {
    this.pollingInterval = setInterval(() => {
      if (this.status !== 'pending') {
        this.stopPolling();
        return;
      }

      this.api
        .get<StatusResponse>(`/pos/upi/${this.intentId}/status`)
        .subscribe({
          next: (res) => {
            const newStatus = res.data?.status;
            if (!newStatus || newStatus === 'pending') return;

            this.status = newStatus;
            this.stopPolling();
            this.stopCountdown();

            if (newStatus === 'completed') {
              this.saleNumber = res.data.saleNumber || '';
              this.saleId = res.data.saleId || 0;
              this.autoEmitTimeout = setTimeout(() => {
                this.paymentComplete.emit({ saleNumber: this.saleNumber, saleId: this.saleId });
              }, 2000);
            }
          },
          error: () => {
            // Silently retry on next interval
          },
        });
    }, 3000);
  }

  private stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  private stopCountdown(): void {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }

  private cleanup(): void {
    this.stopPolling();
    this.stopCountdown();
    if (this.autoEmitTimeout) {
      clearTimeout(this.autoEmitTimeout);
      this.autoEmitTimeout = null;
    }
  }
}
