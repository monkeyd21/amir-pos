import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';

/**
 * §6.4 — Owner PIN setup / change. The single PIN that authorises the Owner
 * Discretion Discount (§2.3) and the EOD variance override (§8.2). Owner only.
 */
@Component({
  selector: 'app-owner-pin',
  standalone: true,
  imports: [CommonModule, FormsModule, PageHeaderComponent],
  template: `
    <div class="p-6 lg:p-8 max-w-lg">
      <app-page-header
        title="Owner PIN"
        subtitle="Authorises discretionary discounts and end-of-day variance overrides"
      ></app-page-header>

      <div class="bg-surface-container rounded-2xl p-6 space-y-4">
        <p class="text-sm font-body text-on-surface-variant">
          @if (configured) {
            An Owner PIN is set. Enter the current PIN to change it.
          } @else {
            No Owner PIN is set yet. Choose one to enable PIN-gated actions.
          }
        </p>

        @if (configured) {
          <div>
            <label class="block text-[11px] font-label font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">Current PIN</label>
            <input type="password" inputmode="numeric" [(ngModel)]="currentPin" data-testid="owner-pin-current"
              class="w-full px-3.5 py-2.5 text-sm font-body text-on-surface bg-surface-container-high/50 rounded-lg border border-outline-variant/15 focus:border-primary focus:ring-1 focus:ring-primary/30 outline-none transition-colors" />
          </div>
        }

        <div>
          <label class="block text-[11px] font-label font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">New PIN (4–8 digits)</label>
          <input type="password" inputmode="numeric" [(ngModel)]="newPin" data-testid="owner-pin-new"
            class="w-full px-3.5 py-2.5 text-sm font-body text-on-surface bg-surface-container-high/50 rounded-lg border border-outline-variant/15 focus:border-primary focus:ring-1 focus:ring-primary/30 outline-none transition-colors" />
        </div>

        <div>
          <label class="block text-[11px] font-label font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5">Confirm New PIN</label>
          <input type="password" inputmode="numeric" [(ngModel)]="confirmPin" data-testid="owner-pin-confirm"
            class="w-full px-3.5 py-2.5 text-sm font-body text-on-surface bg-surface-container-high/50 rounded-lg border border-outline-variant/15 focus:border-primary focus:ring-1 focus:ring-primary/30 outline-none transition-colors" />
          @if (confirmPin && newPin !== confirmPin) {
            <p class="mt-1 text-[11px] font-body text-error">PINs don't match</p>
          }
        </div>

        <button (click)="save()" [disabled]="!canSave" data-testid="owner-pin-save"
          class="w-full px-4 py-2.5 text-sm font-semibold font-body bg-primary text-on-primary rounded-lg disabled:opacity-50 hover:bg-primary/90 transition-colors">
          {{ saving ? 'Saving…' : (configured ? 'Change PIN' : 'Set PIN') }}
        </button>
      </div>
    </div>
  `,
})
export class OwnerPinComponent implements OnInit {
  configured = false;
  currentPin = '';
  newPin = '';
  confirmPin = '';
  saving = false;

  constructor(private api: ApiService, private notify: NotificationService) {}

  ngOnInit(): void {
    this.api.get<any>('/settings/owner-pin/status').subscribe({
      next: (res) => (this.configured = !!res.data?.configured),
      error: () => {},
    });
  }

  get canSave(): boolean {
    if (this.saving) return false;
    if (!/^\d{4,8}$/.test(this.newPin)) return false;
    if (this.newPin !== this.confirmPin) return false;
    if (this.configured && !this.currentPin) return false;
    return true;
  }

  save(): void {
    if (!this.canSave) return;
    this.saving = true;
    const body: any = { newPin: this.newPin };
    if (this.configured) body.currentPin = this.currentPin;
    this.api.put<any>('/settings/owner-pin', body).subscribe({
      next: () => {
        this.saving = false;
        this.configured = true;
        this.currentPin = this.newPin = this.confirmPin = '';
        this.notify.success('Owner PIN saved');
      },
      error: (err) => {
        this.saving = false;
        this.notify.error(err.error?.error || 'Failed to save Owner PIN');
      },
    });
  }
}
