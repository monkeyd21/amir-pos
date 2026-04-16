import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { NotificationService } from '../../../core/services/notification.service';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-mobile-success-screen',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="mobile-pos-root">
      <div class="mp-screen mp-screen--no-nav success-screen">
        <div class="success-inner">
          <div class="check-wrap">
            <div class="check-circle">
              <span class="material-icons check-icon">check</span>
            </div>
          </div>

          <h1 class="success-title">Sale Complete!</h1>

          @if (saleNumber()) {
            <div class="sale-number">{{ saleNumber() }}</div>
          }

          @if (total() !== null) {
            <div class="total-block">
              <div class="total-label">Total Paid</div>
              <div class="total-value">{{ formatCurrency(total() ?? 0) }}</div>
            </div>
          }

          @if (toastVisible()) {
            <div class="toast-success">
              <span class="material-icons">check_circle</span>
              <span>Bill sent!</span>
            </div>
          }

          <div class="actions">
            @if (canSendWhatsapp()) {
              <button
                type="button"
                class="mp-btn mp-btn--primary mp-btn--block mp-btn--lg"
                [disabled]="sending()"
                (click)="sendWhatsapp()"
              >
                @if (sending()) {
                  <span class="spinner" aria-hidden="true"></span>
                  <span>Sending&hellip;</span>
                } @else {
                  <span class="material-icons">chat</span>
                  <span>Send Bill via WhatsApp</span>
                }
              </button>
            } @else {
              <button
                type="button"
                class="mp-btn mp-btn--primary mp-btn--block mp-btn--lg"
                disabled
              >
                <span class="material-icons">person_add</span>
                <span>Add customer to send bill</span>
              </button>
            }

            <button
              type="button"
              class="mp-btn mp-btn--secondary mp-btn--block mp-btn--lg"
              (click)="newSale()"
            >
              <span class="material-icons">add_shopping_cart</span>
              <span>New Sale</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }

    .success-screen {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px 20px;
    }

    .success-inner {
      width: 100%;
      max-width: 420px;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 20px;
    }

    .check-wrap {
      margin: 16px 0 8px;
    }

    .check-circle {
      width: 128px;
      height: 128px;
      border-radius: 50%;
      background: var(--mp-success-soft);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--mp-success);
      box-shadow: 0 12px 48px -12px rgba(74, 222, 128, 0.6);
      animation: mp-pop-in 0.45s cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
    }

    .check-icon {
      font-size: 72px;
      width: 72px;
      height: 72px;
      line-height: 72px;
      font-weight: 700;
      animation: mp-checkmark 0.6s cubic-bezier(0.2, 0.9, 0.3, 1.2) 0.15s both;
    }

    .success-title {
      margin: 0;
      font-size: 34px;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: var(--mp-on-bg);
    }

    .sale-number {
      font-family: ui-monospace, 'SF Mono', Menlo, monospace;
      font-size: 14px;
      color: var(--mp-on-bg-muted);
      letter-spacing: 0.02em;
    }

    .total-block {
      margin: 12px 0 8px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }

    .total-label {
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--mp-on-bg-muted);
    }

    .total-value {
      font-size: 42px;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: var(--mp-on-bg);
    }

    .toast-success {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      border-radius: 999px;
      background: var(--mp-success-soft);
      color: var(--mp-success);
      font-weight: 600;
      font-size: 14px;
      animation: mp-pop-in 0.25s ease-out both;
    }

    .toast-success .material-icons {
      font-size: 18px;
    }

    .actions {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-top: 16px;
    }

    .actions .material-icons {
      font-size: 22px;
    }

    .spinner {
      width: 18px;
      height: 18px;
      border: 2.5px solid rgba(255, 255, 255, 0.35);
      border-top-color: #ffffff;
      border-radius: 50%;
      animation: mp-spin 0.7s linear infinite;
    }

    @keyframes mp-spin {
      to { transform: rotate(360deg); }
    }
  `],
})
export class MobileSuccessScreen implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private notify = inject(NotificationService);

  readonly saleNumber = signal<string | null>(null);
  readonly saleId = signal<number | null>(null);
  readonly total = signal<number | null>(null);
  readonly customerId = signal<number | null>(null);
  readonly customerPhone = signal<string | null>(null);
  readonly customerName = signal<string | null>(null);

  readonly sending = signal(false);
  readonly toastVisible = signal(false);

  readonly canSendWhatsapp = computed(
    () => this.customerId() !== null && !!this.customerPhone(),
  );

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    this.saleNumber.set(params.get('sale'));
    const idRaw = params.get('id');
    this.saleId.set(idRaw ? Number(idRaw) : null);
    const totalRaw = params.get('total');
    this.total.set(totalRaw ? Number(totalRaw) : null);
    const custIdRaw = params.get('customerId');
    this.customerId.set(custIdRaw ? Number(custIdRaw) : null);
    this.customerPhone.set(params.get('customerPhone'));
    this.customerName.set(params.get('customerName'));
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value || 0);
  }

  newSale(): void {
    this.router.navigate(['/mobile-pos/home']);
  }

  async sendWhatsapp(): Promise<void> {
    if (!this.canSendWhatsapp() || this.sending()) return;

    const saleId = this.saleId();
    const saleNumber = this.saleNumber();
    if (!saleId) return;

    this.sending.set(true);
    try {
      const token = localStorage.getItem('accessToken') || '';
      const branchId = localStorage.getItem('branchId') || '1';
      const apiUrl = environment.apiUrl;

      const resp = await fetch(`${apiUrl}/sales/${saleId}/receipt.pdf`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Branch-Id': branchId,
        },
      });
      if (!resp.ok) throw new Error('Failed to fetch bill');
      const blob = await resp.blob();

      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const b64 = result.split(',')[1];
          resolve(b64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const label = saleNumber ?? String(saleId);
      const fileName = `bill-${label}.pdf`;

      if (Capacitor.isNativePlatform()) {
        const written = await Filesystem.writeFile({
          path: fileName,
          data: base64,
          directory: Directory.Cache,
        });
        await Share.share({
          title: `Bill ${label}`,
          text: `Your bill from our store`,
          url: written.uri,
          dialogTitle: 'Share bill',
        });
      } else {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
      }

      this.toastVisible.set(true);
      setTimeout(() => this.toastVisible.set(false), 1500);
    } catch (err: unknown) {
      const e = err as {
        error?: { error?: string; message?: string };
        message?: string;
      };
      const message =
        e?.error?.error ||
        e?.error?.message ||
        e?.message ||
        'Failed to send bill.';
      this.notify.error(message);
    } finally {
      this.sending.set(false);
    }
  }
}
