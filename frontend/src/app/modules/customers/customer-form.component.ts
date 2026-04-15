import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';

@Component({
  selector: 'app-customer-form',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PageHeaderComponent],
  template: `
    <app-page-header [title]="isEdit ? 'Edit Customer' : 'Add Customer'" [subtitle]="isEdit ? 'Update customer information' : 'Register a new customer'">
      <div class="flex items-center gap-2">
        <a routerLink="/customers" class="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold font-body bg-surface-container-highest/60 text-on-surface-variant rounded-lg hover:bg-surface-container-highest transition-colors cursor-pointer">
          <span class="material-symbols-outlined text-lg">arrow_back</span> Back
        </a>
        <button (click)="save()" [disabled]="saving || !form.firstName || !form.lastName || !form.phone"
          class="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold font-body bg-gradient-cta text-white rounded-lg hover:shadow-glow-sm transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
          @if (saving) {
            <div class="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"></div>
          } @else {
            <span class="material-symbols-outlined text-lg">save</span>
          }
          {{ isEdit ? 'Update' : 'Create' }}
        </button>
      </div>
    </app-page-header>

    @if (loading) {
      <div class="flex items-center justify-center py-16">
        <div class="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></div>
      </div>
    } @else {
      <div class="max-w-2xl">
        <div class="bg-surface-container/60 border border-outline-variant/10 rounded-2xl p-6 space-y-5">
          <div class="grid grid-cols-2 gap-4">
            <label class="flex flex-col gap-1.5">
              <span class="text-[10px] font-body text-on-surface-variant uppercase tracking-wider">First Name *</span>
              <input type="text" [(ngModel)]="form.firstName" placeholder="Rahul"
                class="px-3 py-2.5 text-sm font-body bg-surface-container-lowest text-on-surface border border-outline-variant/15 rounded-lg focus:border-primary focus:outline-none" />
            </label>
            <label class="flex flex-col gap-1.5">
              <span class="text-[10px] font-body text-on-surface-variant uppercase tracking-wider">Last Name *</span>
              <input type="text" [(ngModel)]="form.lastName" placeholder="Sharma"
                class="px-3 py-2.5 text-sm font-body bg-surface-container-lowest text-on-surface border border-outline-variant/15 rounded-lg focus:border-primary focus:outline-none" />
            </label>
          </div>
          <label class="flex flex-col gap-1.5">
            <span class="text-[10px] font-body text-on-surface-variant uppercase tracking-wider">Phone *</span>
            <input type="tel" [(ngModel)]="form.phone" placeholder="+91 98765 43210"
              class="px-3 py-2.5 text-sm font-body bg-surface-container-lowest text-on-surface border border-outline-variant/15 rounded-lg focus:border-primary focus:outline-none" />
          </label>
          <label class="flex flex-col gap-1.5">
            <span class="text-[10px] font-body text-on-surface-variant uppercase tracking-wider">Email</span>
            <input type="email" [(ngModel)]="form.email" placeholder="rahul&#64;example.com"
              class="px-3 py-2.5 text-sm font-body bg-surface-container-lowest text-on-surface border border-outline-variant/15 rounded-lg focus:border-primary focus:outline-none" />
          </label>
          <label class="flex flex-col gap-1.5">
            <span class="text-[10px] font-body text-on-surface-variant uppercase tracking-wider">Address</span>
            <textarea [(ngModel)]="form.address" rows="2" placeholder="Full address"
              class="px-3 py-2.5 text-sm font-body bg-surface-container-lowest text-on-surface border border-outline-variant/15 rounded-lg focus:border-primary focus:outline-none resize-none"></textarea>
          </label>
        </div>
      </div>
    }
  `,
})
export class CustomerFormComponent implements OnInit {
  isEdit = false;
  loading = false;
  saving = false;
  customerId: number | null = null;

  form = {
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    address: '',
  };

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    this.isEdit = !!id;
    this.customerId = id ? parseInt(id, 10) : null;
    if (this.customerId) this.loadCustomer(this.customerId);
  }

  loadCustomer(id: number): void {
    this.loading = true;
    this.api.get<any>(`/customers/${id}`).subscribe({
      next: (res: any) => {
        const c = res.data;
        this.form = {
          firstName: c.firstName ?? '',
          lastName: c.lastName ?? '',
          phone: c.phone ?? '',
          email: c.email ?? '',
          address: c.address ?? '',
        };
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.notify.error('Failed to load customer');
      },
    });
  }

  save(): void {
    if (this.saving) return;
    this.saving = true;
    const body: any = { ...this.form };
    if (!body.email) body.email = null;
    if (!body.address) body.address = null;

    const req$ = this.isEdit
      ? this.api.put<any>(`/customers/${this.customerId}`, body)
      : this.api.post<any>('/customers', body);

    req$.subscribe({
      next: (res: any) => {
        this.saving = false;
        this.notify.success(this.isEdit ? 'Customer updated' : 'Customer created');
        const newId = res.data?.id ?? this.customerId;
        this.router.navigate(['/customers', newId]);
      },
      error: (err: any) => {
        this.saving = false;
        this.notify.error(err.error?.error || 'Failed to save customer');
      },
    });
  }
}
