import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject, Subscription, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { NotificationService } from '../../../core/services/notification.service';
import { MobileCartService, MobileCustomer } from '../services/mobile-cart.service';

interface CustomerApi {
  id: number;
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  loyaltyPoints?: number;
  loyaltyTier?: 'bronze' | 'silver' | 'gold' | 'platinum' | string;
  totalSpent?: number;
  visitCount?: number;
}

interface CustomersResponse {
  success: boolean;
  data: CustomerApi[];
  meta?: unknown;
}

interface CreateCustomerResponse {
  success: boolean;
  data: CustomerApi;
}

// Matches +<digits> or <digits> of length 7-15 after stripping spaces/dashes
const PHONE_REGEX = /^\+?\d{7,15}$/;

@Component({
  selector: 'app-mobile-customer-screen',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="mobile-pos-root">
      <div class="mp-screen">
        <header class="mp-header">
          <button
            type="button"
            class="icon-btn"
            aria-label="Back"
            (click)="goBack()"
          >
            <span class="material-icons">arrow_back</span>
          </button>
          <div class="mp-header__title">Customer</div>
          <div class="header-spacer"></div>
        </header>

        <div class="content">
          @if (selectedCustomer(); as cust) {
            <div class="mp-card selected-card">
              <div class="selected-card__top">
                <div class="avatar avatar--lg">{{ initialsOf(cust) }}</div>
                <div class="selected-card__info">
                  <div class="selected-card__name">
                    {{ cust.firstName }} {{ cust.lastName }}
                  </div>
                  <div class="selected-card__phone">{{ cust.phone }}</div>
                  @if (cust.loyaltyTier) {
                    <div class="chip-row">
                      <span class="mp-chip" [ngClass]="tierClass(cust.loyaltyTier)">
                        {{ cust.loyaltyTier }}
                      </span>
                      @if (cust.loyaltyPoints != null) {
                        <span class="points">
                          {{ cust.loyaltyPoints }} pts
                        </span>
                      }
                    </div>
                  }
                </div>
              </div>

              <div class="metrics">
                <div class="metric">
                  <div class="metric__label">Visits</div>
                  <div class="metric__value">{{ cust.visitCount ?? 0 }}</div>
                </div>
                <div class="metric">
                  <div class="metric__label">Total Spent</div>
                  <div class="metric__value">
                    {{ formatCurrency(cust.totalSpent ?? 0) }}
                  </div>
                </div>
              </div>

              <button
                type="button"
                class="mp-btn mp-btn--ghost mp-btn--block remove-btn"
                (click)="removeCustomer()"
              >
                <span class="material-icons">person_remove</span>
                <span>Remove customer</span>
              </button>
            </div>
          }

          <label class="search-field">
            <span class="material-icons search-field__icon">search</span>
            <input
              type="search"
              class="mp-input search-field__input"
              placeholder="Search by name or phone"
              inputmode="search"
              autocomplete="off"
              autocapitalize="off"
              autocorrect="off"
              spellcheck="false"
              [ngModel]="query()"
              (ngModelChange)="onQueryChange($event)"
              name="customerSearch"
            />
            @if (query()) {
              <button
                type="button"
                class="search-field__clear"
                aria-label="Clear search"
                (click)="onQueryChange('')"
              >
                <span class="material-icons">close</span>
              </button>
            }
          </label>

          @if (showAddForm()) {
            <form class="mp-card add-form" (ngSubmit)="submitNewCustomer()">
              <div class="add-form__title">
                <span class="material-icons">person_add</span>
                <span>New customer</span>
              </div>

              <label class="form-field">
                <span class="form-field__label">First Name</span>
                <input
                  class="mp-input"
                  type="text"
                  name="firstName"
                  autocomplete="given-name"
                  [ngModel]="firstName()"
                  (ngModelChange)="firstName.set($event)"
                  required
                />
              </label>

              <label class="form-field">
                <span class="form-field__label">Last Name</span>
                <input
                  class="mp-input"
                  type="text"
                  name="lastName"
                  autocomplete="family-name"
                  [ngModel]="lastName()"
                  (ngModelChange)="lastName.set($event)"
                  required
                />
              </label>

              <label class="form-field">
                <span class="form-field__label">Phone</span>
                <input
                  class="mp-input"
                  type="tel"
                  name="phone"
                  inputmode="tel"
                  readonly
                  [ngModel]="newPhone()"
                  (ngModelChange)="newPhone.set($event)"
                />
              </label>

              @if (createError()) {
                <div class="form-error">
                  <span class="material-icons">error_outline</span>
                  <span>{{ createError() }}</span>
                </div>
              }

              <div class="form-actions">
                <button
                  type="button"
                  class="mp-btn mp-btn--ghost"
                  [disabled]="creating()"
                  (click)="cancelAdd()"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  class="mp-btn mp-btn--primary"
                  [disabled]="creating() || !canSubmit()"
                >
                  @if (creating()) {
                    <span class="spinner" aria-hidden="true"></span>
                    <span>Creating&hellip;</span>
                  } @else {
                    <span>Create &amp; Select</span>
                  }
                </button>
              </div>
            </form>
          }

          @if (loading()) {
            <div class="list-status">
              <span class="spinner"></span>
              <span>Searching&hellip;</span>
            </div>
          } @else if (error()) {
            <div class="list-status list-status--error">
              <span class="material-icons">error_outline</span>
              <span>{{ error() }}</span>
            </div>
          } @else if (!query().trim()) {
            <div class="empty">
              <span class="material-icons empty__icon">group_search</span>
              <p>Search by name or phone to select a customer</p>
            </div>
          } @else if (results().length === 0) {
            @if (queryIsPhone() && !showAddForm()) {
              <div class="mp-card no-match-card">
                <div class="no-match-card__icon">
                  <span class="material-icons">phone_disabled</span>
                </div>
                <div class="no-match-card__title">
                  No customer found with phone {{ normalizedPhone() }}
                </div>
                <button
                  type="button"
                  class="mp-btn mp-btn--primary mp-btn--block"
                  (click)="openAddForm()"
                >
                  <span class="material-icons">person_add</span>
                  <span>Add new customer with this phone</span>
                </button>
              </div>
            } @else {
              <div class="empty">
                <span class="material-icons empty__icon">person_off</span>
                <p>No customers match &ldquo;{{ query() }}&rdquo;</p>
              </div>
            }
          } @else {
            <div class="results">
              @for (c of results(); track c.id) {
                <button
                  type="button"
                  class="result-card"
                  (click)="selectCustomer(c)"
                >
                  <div class="avatar">{{ initialsOf(c) }}</div>
                  <div class="result-card__info">
                    <div class="result-card__name">
                      {{ c.firstName }} {{ c.lastName }}
                    </div>
                    <div class="result-card__phone">{{ c.phone }}</div>
                  </div>
                  <div class="result-card__meta">
                    @if (c.loyaltyTier) {
                      <span class="mp-chip" [ngClass]="tierClass(c.loyaltyTier)">
                        {{ c.loyaltyTier }}
                      </span>
                    }
                    @if (c.loyaltyPoints != null) {
                      <span class="points">{{ c.loyaltyPoints }} pts</span>
                    }
                  </div>
                </button>
              }
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }

    .content {
      padding: 16px 20px 32px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .icon-btn {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      border: 0;
      background: var(--mp-surface-2);
      color: var(--mp-on-bg);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }

    .icon-btn .material-icons {
      font-size: 22px;
    }

    .header-spacer {
      width: 40px;
      height: 40px;
    }

    .selected-card {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .selected-card__top {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .selected-card__info {
      flex: 1;
      min-width: 0;
    }

    .selected-card__name {
      font-size: 18px;
      font-weight: 700;
      color: var(--mp-on-bg);
      margin-bottom: 2px;
    }

    .selected-card__phone {
      color: var(--mp-on-bg-muted);
      font-size: 14px;
      font-variant-numeric: tabular-nums;
    }

    .chip-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 8px;
    }

    .points {
      color: var(--mp-on-bg-muted);
      font-size: 12px;
      font-weight: 600;
    }

    .metrics {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    .metric {
      background: var(--mp-surface-2);
      border-radius: 14px;
      padding: 12px 14px;
    }

    .metric__label {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.04em;
      color: var(--mp-on-bg-muted);
      text-transform: uppercase;
      margin-bottom: 4px;
    }

    .metric__value {
      font-size: 18px;
      font-weight: 700;
      color: var(--mp-on-bg);
    }

    .remove-btn {
      color: var(--mp-error);
    }

    .remove-btn .material-icons { font-size: 20px; }

    .avatar {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: var(--mp-primary-soft);
      color: var(--mp-primary);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 15px;
      flex-shrink: 0;
      letter-spacing: 0.02em;
    }

    .avatar--lg {
      width: 60px;
      height: 60px;
      font-size: 20px;
    }

    .search-field {
      position: relative;
      display: block;
    }

    .search-field__icon {
      position: absolute;
      left: 16px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--mp-on-bg-faint);
      font-size: 22px;
      pointer-events: none;
    }

    .search-field__input {
      padding-left: 48px;
      padding-right: 48px;
    }

    .search-field__clear {
      position: absolute;
      right: 10px;
      top: 50%;
      transform: translateY(-50%);
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: 0;
      background: var(--mp-surface-2);
      color: var(--mp-on-bg-muted);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }

    .search-field__clear .material-icons {
      font-size: 18px;
    }

    .results {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .result-card {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
      padding: 14px 16px;
      background: var(--mp-surface);
      border: 1px solid var(--mp-border);
      border-radius: 16px;
      cursor: pointer;
      text-align: left;
      color: var(--mp-on-bg);
      transition: transform 0.08s ease, background 0.15s ease;
    }

    .result-card:active {
      transform: scale(0.98);
      background: var(--mp-surface-2);
    }

    .result-card__info {
      flex: 1;
      min-width: 0;
    }

    .result-card__name {
      font-size: 15px;
      font-weight: 600;
      margin-bottom: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .result-card__phone {
      font-size: 13px;
      color: var(--mp-on-bg-muted);
      font-variant-numeric: tabular-nums;
    }

    .result-card__meta {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 4px;
    }

    .list-status {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 24px;
      color: var(--mp-on-bg-muted);
      font-size: 14px;
    }

    .list-status--error {
      color: var(--mp-error);
    }

    .list-status .material-icons {
      font-size: 20px;
    }

    .spinner {
      width: 18px;
      height: 18px;
      border: 2.5px solid rgba(255, 255, 255, 0.15);
      border-top-color: var(--mp-primary);
      border-radius: 50%;
      animation: mp-spin 0.7s linear infinite;
    }

    @keyframes mp-spin { to { transform: rotate(360deg); } }

    .empty {
      text-align: center;
      padding: 40px 20px;
      color: var(--mp-on-bg-muted);
    }

    .empty__icon {
      font-size: 48px;
      color: var(--mp-on-bg-faint);
      margin-bottom: 12px;
      display: block;
    }

    .empty p {
      margin: 0;
      font-size: 14px;
    }

    .no-match-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 14px;
      text-align: center;
      padding: 22px 20px;
    }

    .no-match-card__icon {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: var(--mp-surface-2);
      color: var(--mp-on-bg-muted);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .no-match-card__icon .material-icons { font-size: 28px; }

    .no-match-card__title {
      font-size: 15px;
      font-weight: 600;
      color: var(--mp-on-bg);
    }

    .add-form {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .add-form__title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 15px;
      font-weight: 700;
      color: var(--mp-on-bg);
    }

    .add-form__title .material-icons {
      font-size: 20px;
      color: var(--mp-primary);
    }

    .form-field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .form-field__label {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--mp-on-bg-muted);
      padding-left: 2px;
    }

    .form-error {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--mp-error);
      font-size: 13px;
    }

    .form-error .material-icons { font-size: 18px; }

    .form-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-top: 4px;
    }
  `],
})
export class MobileCustomerScreen implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private cart = inject(MobileCartService);
  private router = inject(Router);
  private notify = inject(NotificationService);

  readonly selectedCustomer = computed(() => this.cart.customer());
  readonly query = signal('');
  readonly results = signal<CustomerApi[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');

  // Add-new-customer inline form state
  readonly showAddForm = signal(false);
  readonly firstName = signal('');
  readonly lastName = signal('');
  readonly newPhone = signal('');
  readonly creating = signal(false);
  readonly createError = signal('');

  /** Strips spaces/dashes and returns the normalized phone string */
  readonly normalizedPhone = computed(() =>
    this.query().trim().replace(/[\s-]/g, ''),
  );

  readonly queryIsPhone = computed(() => PHONE_REGEX.test(this.normalizedPhone()));

  readonly canSubmit = computed(
    () =>
      this.firstName().trim().length > 0 &&
      this.lastName().trim().length > 0 &&
      this.newPhone().trim().length > 0,
  );

  private search$ = new Subject<string>();
  private sub?: Subscription;

  ngOnInit(): void {
    this.sub = this.search$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((term) => {
          const trimmed = term.trim();
          if (!trimmed) {
            this.results.set([]);
            this.loading.set(false);
            this.error.set('');
            return [];
          }
          this.loading.set(true);
          this.error.set('');
          return this.api.get<CustomersResponse>('/customers', {
            search: trimmed,
            limit: 20,
          });
        }),
      )
      .subscribe({
        next: (response) => {
          this.loading.set(false);
          if (response && (response as CustomersResponse).data) {
            this.results.set((response as CustomersResponse).data ?? []);
          }
        },
        error: (err) => {
          this.loading.set(false);
          this.error.set(
            err?.error?.error ||
              err?.error?.message ||
              err?.message ||
              'Failed to search customers',
          );
        },
      });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  onQueryChange(value: string): void {
    this.query.set(value);
    // If user edits the query, close any open add-form — it would be stale
    if (this.showAddForm()) {
      this.showAddForm.set(false);
      this.createError.set('');
    }
    this.search$.next(value);
  }

  openAddForm(): void {
    this.newPhone.set(this.normalizedPhone());
    this.firstName.set('');
    this.lastName.set('');
    this.createError.set('');
    this.showAddForm.set(true);
  }

  cancelAdd(): void {
    this.showAddForm.set(false);
    this.createError.set('');
  }

  submitNewCustomer(): void {
    if (!this.canSubmit() || this.creating()) return;
    this.creating.set(true);
    this.createError.set('');

    const payload = {
      firstName: this.firstName().trim(),
      lastName: this.lastName().trim(),
      phone: this.newPhone().trim(),
    };

    this.api.post<CreateCustomerResponse>('/customers', payload).subscribe({
      next: (res) => {
        this.creating.set(false);
        const c = res?.data;
        if (!c) {
          this.createError.set('Unexpected response from server.');
          return;
        }
        const customer: MobileCustomer = {
          id: c.id,
          firstName: c.firstName,
          lastName: c.lastName,
          phone: c.phone,
          loyaltyPoints: c.loyaltyPoints,
          loyaltyTier: c.loyaltyTier,
          totalSpent: c.totalSpent,
          visitCount: c.visitCount,
        };
        this.cart.setCustomer(customer);
        this.notify.success('Customer created.');
        this.router.navigate(['/mobile-pos/cart']);
      },
      error: (err) => {
        this.creating.set(false);
        this.createError.set(
          err?.error?.error ||
            err?.error?.message ||
            err?.message ||
            'Failed to create customer',
        );
      },
    });
  }

  selectCustomer(c: CustomerApi): void {
    const customer: MobileCustomer = {
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      phone: c.phone,
      loyaltyPoints: c.loyaltyPoints,
      loyaltyTier: c.loyaltyTier,
      totalSpent: c.totalSpent,
      visitCount: c.visitCount,
    };
    this.cart.setCustomer(customer);
    this.router.navigate(['/mobile-pos/cart']);
  }

  removeCustomer(): void {
    this.cart.setCustomer(null);
  }

  goBack(): void {
    this.router.navigate(['/mobile-pos/home']);
  }

  initialsOf(c: { firstName?: string; lastName?: string }): string {
    const f = (c.firstName || '').trim();
    const l = (c.lastName || '').trim();
    return `${f.charAt(0)}${l.charAt(0)}`.toUpperCase() || '?';
  }

  tierClass(tier?: string): string {
    const t = (tier || '').toLowerCase();
    if (t === 'bronze') return 'mp-tier-bronze';
    if (t === 'silver') return 'mp-tier-silver';
    if (t === 'gold') return 'mp-tier-gold';
    if (t === 'platinum') return 'mp-tier-platinum';
    return 'mp-tier-bronze';
  }

  formatCurrency(v: number): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(v);
  }
}
