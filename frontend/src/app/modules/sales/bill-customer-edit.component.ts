import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

/**
 * bug5 — limited bill editing.
 *
 * A closed bill's money is immutable: no lines, quantities, prices, totals or
 * payments are editable anywhere, because those feed GST, commission and the
 * day's reconciliation. The one thing that genuinely does get typed wrong at
 * the counter is who the bill belongs to, and fixing that used to mean voiding
 * and rebilling. This page corrects just that.
 *
 * A full page rather than a dialog — the layout's fixed sidebar and backdrop
 * filter make overlay modals unreachable here (see memory/feedback_no_modals).
 */
@Component({
  selector: 'app-bill-customer-edit',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PageHeaderComponent],
  template: `
    <app-page-header
      title="Edit Bill Customer"
      [subtitle]="sale ? 'Bill ' + sale.saleNumber : 'Correct the customer name or contact'">
      <div class="flex items-center gap-2">
        <a [routerLink]="['/sales', saleId]"
          class="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold font-body bg-surface-container-highest/60 text-on-surface-variant rounded-lg hover:bg-surface-container-highest transition-colors cursor-pointer">
          <span class="material-symbols-outlined text-lg">arrow_back</span> Back to bill
        </a>
        <button (click)="save()" [disabled]="saving || !form.firstName.trim() || !form.phone.trim()"
          class="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold font-body bg-gradient-cta text-white rounded-lg hover:shadow-glow-sm transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
          @if (saving) {
            <div class="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"></div>
          } @else {
            <span class="material-symbols-outlined text-lg">save</span>
          }
          Save
        </button>
      </div>
    </app-page-header>

    @if (loading) {
      <div class="flex items-center justify-center py-16">
        <div class="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></div>
      </div>
    } @else if (sale) {
      <div class="max-w-2xl space-y-4">
        <div class="flex items-start gap-3 rounded-xl border border-outline-variant/15 bg-surface-container-high/40 px-4 py-3">
          <span class="material-symbols-outlined text-base text-on-surface-variant/70 mt-0.5">info</span>
          <p class="text-xs text-on-surface-variant leading-relaxed">
            Only the customer's name and contact can be changed on a completed bill. Items, prices,
            discounts and payments are locked — they feed GST, commission and the day's cash
            reconciliation. Every edit here is recorded in the audit trail.
          </p>
        </div>

        @if (!sale.customer) {
          <div class="flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3">
            <span class="material-symbols-outlined text-base text-amber-400 mt-0.5">person_add</span>
            <p class="text-xs text-amber-200/90 leading-relaxed">
              This was billed as a walk-in. Saving will create the customer and attach them to this
              bill — useful when someone asks to be added to loyalty after paying.
            </p>
          </div>
        }

        <div class="bg-surface-container/60 border border-outline-variant/10 rounded-2xl p-6 space-y-5">
          <div class="grid grid-cols-2 gap-4">
            <label class="flex flex-col gap-1.5">
              <span class="text-[10px] font-body text-on-surface-variant uppercase tracking-wider">First Name *</span>
              <input type="text" [(ngModel)]="form.firstName" placeholder="Rahul"
                class="px-3 py-2.5 text-sm font-body bg-surface-container-lowest text-on-surface border border-outline-variant/15 rounded-lg focus:border-primary focus:outline-none" />
            </label>
            <label class="flex flex-col gap-1.5">
              <span class="text-[10px] font-body text-on-surface-variant uppercase tracking-wider">Last Name</span>
              <input type="text" [(ngModel)]="form.lastName" placeholder="Sharma"
                class="px-3 py-2.5 text-sm font-body bg-surface-container-lowest text-on-surface border border-outline-variant/15 rounded-lg focus:border-primary focus:outline-none" />
            </label>
          </div>
          <label class="flex flex-col gap-1.5">
            <span class="text-[10px] font-body text-on-surface-variant uppercase tracking-wider">Phone *</span>
            <input type="tel" [(ngModel)]="form.phone" placeholder="9876543210"
              class="px-3 py-2.5 text-sm font-body bg-surface-container-lowest text-on-surface border border-outline-variant/15 rounded-lg focus:border-primary focus:outline-none" />
            <span class="text-[10px] text-on-surface-variant/60">
              If this number already belongs to a different customer, the edit is refused — that
              would merge two people's purchase history rather than fix a typo.
            </span>
          </label>
        </div>
      </div>
    } @else {
      <div class="py-16 text-center text-sm text-on-surface-variant">Bill not found.</div>
    }
  `,
})
export class BillCustomerEditComponent implements OnInit {
  saleId!: number;
  sale: { saleNumber: string; customer?: { firstName: string; lastName?: string | null; phone: string } | null } | null =
    null;
  loading = true;
  saving = false;
  form = { firstName: '', lastName: '', phone: '' };

  constructor(
    private api: ApiService,
    private route: ActivatedRoute,
    private router: Router,
    private notification: NotificationService
  ) {}

  ngOnInit(): void {
    this.saleId = Number(this.route.snapshot.paramMap.get('id'));
    this.api.get<ApiResponse<any>>(`/sales/${this.saleId}`).subscribe({
      next: (res) => {
        this.sale = res.data;
        const c = res.data?.customer;
        if (c) {
          this.form = {
            firstName: c.firstName || '',
            lastName: c.lastName || '',
            phone: c.phone || '',
          };
        }
        this.loading = false;
      },
      error: () => {
        this.notification.error('Failed to load the bill');
        this.loading = false;
      },
    });
  }

  save(): void {
    this.saving = true;
    this.api
      .put<ApiResponse<any>>(`/sales/${this.saleId}/customer`, {
        firstName: this.form.firstName.trim(),
        lastName: this.form.lastName.trim() || null,
        phone: this.form.phone.trim(),
      })
      .subscribe({
        next: (res) => {
          this.notification.success(res.message || 'Customer updated');
          this.saving = false;
          this.router.navigate(['/sales', this.saleId]);
        },
        error: (err) => {
          this.notification.error(err?.message || 'Failed to update the customer');
          this.saving = false;
        },
      });
  }
}
