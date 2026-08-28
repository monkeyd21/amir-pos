import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';

interface Branch {
  id: number;
  name: string;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

@Component({
  selector: 'app-employee-form',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PageHeaderComponent],
  template: `
    <app-page-header [title]="isEdit ? 'Edit Employee' : 'Add Employee'" [subtitle]="isEdit ? 'Update employee information' : 'Add a new team member'">
      <div class="flex items-center gap-2">
        <a routerLink="/employees" class="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold font-body bg-surface-container-highest/60 text-on-surface-variant rounded-lg hover:bg-surface-container-highest transition-colors cursor-pointer">
          <span class="material-symbols-outlined text-lg">arrow_back</span> Back
        </a>
        <button (click)="save()" [disabled]="saving || !form.firstName || (!isEdit && !form.password)"
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
              <input type="text" [(ngModel)]="form.firstName" placeholder="John"
                class="px-3 py-2.5 text-sm font-body bg-surface-container-lowest text-on-surface border border-outline-variant/15 rounded-lg focus:border-primary focus:outline-none" />
            </label>
            <label class="flex flex-col gap-1.5">
              <span class="text-[10px] font-body text-on-surface-variant uppercase tracking-wider">Last Name</span>
              <input type="text" [(ngModel)]="form.lastName" placeholder="Doe"
                class="px-3 py-2.5 text-sm font-body bg-surface-container-lowest text-on-surface border border-outline-variant/15 rounded-lg focus:border-primary focus:outline-none" />
            </label>
          </div>

          <label class="flex flex-col gap-1.5">
            <span class="text-[10px] font-body text-on-surface-variant uppercase tracking-wider">Email</span>
            <input type="email" [(ngModel)]="form.email" placeholder="john&#64;clothingerp.com"
              class="px-3 py-2.5 text-sm font-body bg-surface-container-lowest text-on-surface border border-outline-variant/15 rounded-lg focus:border-primary focus:outline-none" />
          </label>

          <label class="flex flex-col gap-1.5">
            <span class="text-[10px] font-body text-on-surface-variant uppercase tracking-wider">Phone</span>
            <input type="tel" [(ngModel)]="form.phone" placeholder="+91 98765 43210"
              class="px-3 py-2.5 text-sm font-body bg-surface-container-lowest text-on-surface border border-outline-variant/15 rounded-lg focus:border-primary focus:outline-none" />
          </label>

          <div class="grid grid-cols-2 gap-4">
            <label class="flex flex-col gap-1.5">
              <span class="text-[10px] font-body text-on-surface-variant uppercase tracking-wider">Role</span>
              <select [(ngModel)]="form.role"
                class="px-3 py-2.5 text-sm font-body bg-surface-container-lowest text-on-surface border border-outline-variant/15 rounded-lg focus:border-primary focus:outline-none cursor-pointer">
                @for (r of roles; track r.value) {
                  <option [value]="r.value">{{ r.label }}</option>
                }
              </select>
            </label>
            <label class="flex flex-col gap-1.5">
              <span class="text-[10px] font-body text-on-surface-variant uppercase tracking-wider">Branch</span>
              <select [(ngModel)]="form.branchId"
                class="px-3 py-2.5 text-sm font-body bg-surface-container-lowest text-on-surface border border-outline-variant/15 rounded-lg focus:border-primary focus:outline-none cursor-pointer">
                <option [ngValue]="null">Select branch...</option>
                @for (b of branches; track b.id) {
                  <option [ngValue]="b.id">{{ b.name }}</option>
                }
              </select>
            </label>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <label class="flex flex-col gap-1.5">
              <span class="text-[10px] font-body text-on-surface-variant uppercase tracking-wider">Commission Rate (%)</span>
              <div class="relative w-full">
                <input type="number" [(ngModel)]="form.commissionRate" min="0" max="100" step="0.5" placeholder="0"
                  class="w-full px-3 py-2.5 pr-8 text-sm font-body bg-surface-container-lowest text-on-surface border border-outline-variant/15 rounded-lg focus:border-primary focus:outline-none" />
                <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-on-surface-variant/60">%</span>
              </div>
              <p class="text-[10px] text-on-surface-variant/60">Percentage of sale amount earned as commission</p>
            </label>
            <label class="flex flex-col gap-1.5">
              <span class="text-[10px] font-body text-on-surface-variant uppercase tracking-wider">Daily Sales Target (₹)</span>
              <div class="relative w-full">
                <span class="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-on-surface-variant/60">₹</span>
                <input type="number" [(ngModel)]="form.commissionThreshold" min="0" step="100" placeholder="0"
                  class="w-full pl-7 pr-3 py-2.5 text-sm font-body bg-surface-container-lowest text-on-surface border border-outline-variant/15 rounded-lg focus:border-primary focus:outline-none" />
              </div>
              <p class="text-[10px] text-on-surface-variant/60">Commission is earned only on this employee's daily sales above this amount. 0 = no target.</p>
            </label>
          </div>

          <!-- Payroll: drives the attendance grid + monthly salary run -->
          <div class="pt-4 border-t border-outline-variant/10 space-y-4">
            <p class="text-[10px] font-body text-on-surface-variant uppercase tracking-wider">Payroll</p>

            <div class="grid grid-cols-2 gap-4">
              <label class="flex flex-col gap-1.5">
                <span class="text-[10px] font-body text-on-surface-variant uppercase tracking-wider">Joining Date</span>
                <input type="date" [(ngModel)]="form.joiningDate"
                  class="px-3 py-2.5 text-sm font-body bg-surface-container-lowest text-on-surface border border-outline-variant/15 rounded-lg focus:border-primary focus:outline-none" />
                <p class="text-[10px] text-on-surface-variant/60">Days before this are never markable and count as absent for a fixed monthly salary.</p>
              </label>
              <label class="flex flex-col gap-1.5">
                <span class="text-[10px] font-body text-on-surface-variant uppercase tracking-wider">Salary Type</span>
                <select [(ngModel)]="form.salaryType"
                  class="px-3 py-2.5 text-sm font-body bg-surface-container-lowest text-on-surface border border-outline-variant/15 rounded-lg focus:border-primary focus:outline-none cursor-pointer">
                  <option [ngValue]="null">Not on payroll</option>
                  <option value="fixed_monthly">Fixed Monthly</option>
                  <option value="daily_wage">Daily Wage</option>
                </select>
              </label>
            </div>

            <div class="grid grid-cols-2 gap-4">
              @if (form.salaryType === 'fixed_monthly') {
                <label class="flex flex-col gap-1.5">
                  <span class="text-[10px] font-body text-on-surface-variant uppercase tracking-wider">Monthly Salary (₹)</span>
                  <input type="number" min="0" step="100" [(ngModel)]="form.monthlySalary" placeholder="0"
                    class="px-3 py-2.5 text-sm font-body bg-surface-container-lowest text-on-surface border border-outline-variant/15 rounded-lg focus:border-primary focus:outline-none" />
                </label>
              }
              <label class="flex flex-col gap-1.5">
                <span class="text-[10px] font-body text-on-surface-variant uppercase tracking-wider">Per Day Rate (₹)</span>
                <input type="number" min="0" step="10" [(ngModel)]="form.perDayRate" placeholder="0"
                  class="px-3 py-2.5 text-sm font-body bg-surface-container-lowest text-on-surface border border-outline-variant/15 rounded-lg focus:border-primary focus:outline-none" />
                <p class="text-[10px] text-on-surface-variant/60">
                  {{ form.salaryType === 'daily_wage' ? 'Paid per day worked.' : 'Used to deduct absences and half days.' }}
                </p>
              </label>
              <label class="flex flex-col gap-1.5">
                <span class="text-[10px] font-body text-on-surface-variant uppercase tracking-wider">Weekly Off Day</span>
                <select [(ngModel)]="form.weeklyOffDay"
                  class="px-3 py-2.5 text-sm font-body bg-surface-container-lowest text-on-surface border border-outline-variant/15 rounded-lg focus:border-primary focus:outline-none cursor-pointer">
                  <option [ngValue]="null">None</option>
                  @for (d of weekDays; track d.value) {
                    <option [ngValue]="d.value">{{ d.label }}</option>
                  }
                </select>
              </label>
            </div>
          </div>

          @if (isEdit) {
            <label class="flex flex-col gap-1.5">
              <span class="text-[10px] font-body text-on-surface-variant uppercase tracking-wider">Status</span>
              <div class="flex items-center gap-3 h-[42px]">
                <input type="checkbox" [(ngModel)]="form.isActive" class="w-5 h-5 rounded" />
                <span class="text-sm font-body text-on-surface">{{ form.isActive ? 'Active' : 'Inactive' }}</span>
              </div>
            </label>
          }

          <label class="flex flex-col gap-1.5 pt-2 border-t border-outline-variant/10">
            <span class="text-[10px] font-body text-on-surface-variant uppercase tracking-wider">
              {{ isEdit ? 'Reset Password' : 'Password *' }}
            </span>
            <input type="password" [(ngModel)]="form.password" autocomplete="new-password"
              [placeholder]="isEdit ? 'Leave blank to keep current password' : 'At least 6 characters'"
              class="px-3 py-2.5 text-sm font-body bg-surface-container-lowest text-on-surface border border-outline-variant/15 rounded-lg focus:border-primary focus:outline-none" />
            <p class="text-[10px] text-on-surface-variant/60">
              {{ isEdit ? 'Only fill this in to change the login password.' : 'The employee logs in with their email and this password.' }}
            </p>
          </label>
        </div>
      </div>
    }
  `,
})
export class EmployeeFormComponent implements OnInit {
  isEdit = false;
  loading = false;
  saving = false;
  employeeId: number | null = null;
  branches: Branch[] = [];

  form = {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    role: 'staff',
    branchId: null as number | null,
    commissionRate: 0,
    commissionThreshold: 0,
    joiningDate: '' as string,
    salaryType: null as 'fixed_monthly' | 'daily_wage' | null,
    monthlySalary: null as number | null,
    perDayRate: null as number | null,
    weeklyOffDay: null as number | null,
    isActive: true,
    password: '',
  };

  weekDays = [
    { value: 0, label: 'Sunday' },
    { value: 1, label: 'Monday' },
    { value: 2, label: 'Tuesday' },
    { value: 3, label: 'Wednesday' },
    { value: 4, label: 'Thursday' },
    { value: 5, label: 'Friday' },
    { value: 6, label: 'Saturday' },
  ];

  roles = [
    { value: 'owner', label: 'Owner' },
    { value: 'manager', label: 'Manager' },
    { value: 'cashier', label: 'Cashier' },
    { value: 'staff', label: 'Staff' },
  ];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    this.isEdit = !!id;
    this.employeeId = id ? parseInt(id, 10) : null;
    this.loadBranches();
    if (this.employeeId) this.loadEmployee(this.employeeId);
  }

  loadBranches(): void {
    this.api.get<ApiResponse<Branch[]>>('/branches').subscribe({
      next: (res) => (this.branches = res.data ?? []),
    });
  }

  loadEmployee(id: number): void {
    this.loading = true;
    this.api.get<ApiResponse<any>>(`/employees`).subscribe({
      next: (res) => {
        const emp = (res.data ?? []).find((e: any) => e.id === id);
        if (emp) {
          this.form = {
            firstName: emp.firstName ?? '',
            lastName: emp.lastName ?? '',
            email: emp.email ?? '',
            phone: emp.phone ?? '',
            role: emp.role ?? 'staff',
            branchId: emp.branch?.id ?? emp.branchId ?? null,
            commissionRate: Number(emp.commissionRate ?? 0),
            commissionThreshold: Number(emp.commissionThreshold ?? 0),
            // Prisma @db.Date serialises as an ISO datetime — the date half is
            // already the intended IST day, so slice rather than re-parse.
            joiningDate: emp.joiningDate ? String(emp.joiningDate).slice(0, 10) : '',
            salaryType: emp.salaryType ?? null,
            monthlySalary: emp.monthlySalary != null ? Number(emp.monthlySalary) : null,
            perDayRate: emp.perDayRate != null ? Number(emp.perDayRate) : null,
            weeklyOffDay: emp.weeklyOffDay ?? null,
            isActive: emp.isActive ?? true,
            password: '',
          };
        }
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.notify.error('Failed to load employee');
      },
    });
  }

  save(): void {
    if (this.saving) return;
    this.saving = true;

    const body: any = { ...this.form };
    if (!body.phone) body.phone = null;
    if (!body.joiningDate) body.joiningDate = null;
    if (body.monthlySalary === '' ) body.monthlySalary = null;
    if (body.perDayRate === '') body.perDayRate = null;

    const req$ = this.isEdit
      ? this.api.put<ApiResponse<any>>(`/employees/${this.employeeId}`, body)
      : this.api.post<ApiResponse<any>>('/employees', body);

    req$.subscribe({
      next: () => {
        this.saving = false;
        this.notify.success(this.isEdit ? 'Employee updated' : 'Employee created');
        this.router.navigate(['/employees']);
      },
      error: (err) => {
        this.saving = false;
        this.notify.error(err.error?.error || 'Failed to save employee');
      },
    });
  }
}
