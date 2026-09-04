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

interface BillCustomer {
  firstName: string;
  lastName?: string | null;
  phone: string;
  email?: string | null;
  address?: string | null;
}

/**
 * bug5 (limited bill editing).
 *
 * A closed bill's money is immutable: no lines, quantities, prices, totals or
 * payments are editable anywhere, because those feed GST, commission and the
 * day's reconciliation. The one thing that genuinely does get typed wrong at
 * the counter is who the bill belongs to, and fixing that used to mean voiding
 * and rebilling. This page corrects just that.
 *
 * A full page rather than a dialog: the layout's fixed sidebar and backdrop
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
        <button (click)="save()" [disabled]="saving || !!firstError"
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
            discounts and payments are locked: they feed GST, commission and the day's cash
            reconciliation. Every edit here is recorded in the audit trail.
          </p>
        </div>

        @if (!sale.customer) {
          <div class="flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3">
            <span class="material-symbols-outlined text-base text-amber-400 mt-0.5">person_add</span>
            <p class="text-xs text-amber-200/90 leading-relaxed">
              This was billed as a walk-in. Saving will create the customer and attach them to this
              bill, useful when someone asks to be added to loyalty after paying.
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
            <input type="tel" [(ngModel)]="form.phone" placeholder="+91 98765 43210"
              class="px-3 py-2.5 text-sm font-body bg-surface-container-lowest text-on-surface border border-outline-variant/15 rounded-lg focus:border-primary focus:outline-none" />
            @if (phoneError) {
              <span class="text-[10px] font-body text-red-400">{{ phoneError }}</span>
            }
            <span class="text-[10px] font-body text-on-surface-variant/60">
              If this number already belongs to a different customer, the edit is refused: that
              would merge two people's purchase history rather than fix a typo.
            </span>
          </label>
          <label class="flex flex-col gap-1.5">
            <span class="text-[10px] font-body text-on-surface-variant uppercase tracking-wider">Email</span>
            <input type="email" [(ngModel)]="form.email" placeholder="rahul&#64;example.com"
              class="px-3 py-2.5 text-sm font-body bg-surface-container-lowest text-on-surface border border-outline-variant/15 rounded-lg focus:border-primary focus:outline-none" />
            @if (emailError) {
              <span class="text-[10px] font-body text-red-400">{{ emailError }}</span>
            }
          </label>
          <label class="flex flex-col gap-1.5">
            <span class="text-[10px] font-body text-on-surface-variant uppercase tracking-wider">Address</span>
            <textarea [(ngModel)]="form.address" rows="2" placeholder="Full address"
              class="px-3 py-2.5 text-sm font-body bg-surface-container-lowest text-on-surface border border-outline-variant/15 rounded-lg focus:border-primary focus:outline-none resize-none"></textarea>
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
  sale: { saleNumber: string; customer?: BillCustomer | null } | null = null;
  loading = true;
  saving = false;
  form = { firstName: '', lastName: '', phone: '', email: '', address: '' };

  /**
   * Mirrors `customerPhoneSchema` / `customerEmailSchema` on the server, the
   * same rules the customers module's own create form is checked against. The
   * server is the authority; this only saves the cashier a round trip.
   */
  get phoneError(): string | null {
    const phone = this.form.phone.trim();
    // Nothing typed yet is not an error to shout about: the disabled Save
    // already says the form is incomplete. Only wrong input turns red.
    if (!phone) return null;
    if (!/^[0-9+\-\s()]+$/.test(phone)) return 'Enter a valid phone number';
    if ((phone.match(/\d/g) ?? []).length < 10) return 'Phone must contain at least 10 digits';
    if (phone.length > 20) return 'Phone number is too long';
    return null; // matches customerPhoneSchema, split up so one message shows at a time
  }

  get emailError(): string | null {
    const email = this.form.email.trim();
    if (!email) return null;
    return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email) ? null : 'Enter a valid email address';
  }

  /** Blocks Save, and is what the toast says if Save is somehow reached. */
  get firstError(): string | null {
    if (!this.form.firstName.trim()) return 'First name is required';
    if (!this.form.phone.trim()) return 'Phone is required';
    return this.phoneError ?? this.emailError;
  }

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
            email: c.email || '',
            address: c.address || '',
          };
        }
        this.loading = false;
      },
      // The HTTP error interceptor already toasts the server's own message,
      // so notifying again here would stack a second, rawer toast on top.
      error: () => {
        this.loading = false;
      },
    });
  }

  save(): void {
    if (this.firstError) {
      this.notification.error(this.firstError);
      return;
    }
    this.saving = true;
    // Contact fields only. The bill's money is not on this form and not in
    // this payload, and the endpoint would ignore it if it were.
    this.api
      .put<ApiResponse<any>>(`/sales/${this.saleId}/customer`, {
        firstName: this.form.firstName.trim(),
        lastName: this.form.lastName.trim() || null,
        phone: this.form.phone.trim(),
        email: this.form.email.trim() || null,
        address: this.form.address.trim() || null,
      })
      .subscribe({
        next: (res) => {
          this.notification.success(res.message || 'Customer updated');
          this.saving = false;
          this.router.navigate(['/sales', this.saleId]);
        },
        error: () => {
          this.saving = false;
        },
      });
  }
}
