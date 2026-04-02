import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApiService } from '../../../core/services/api.service';
import { AuthService, User } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { PageHeaderComponent } from '../../../shared/page-header/page-header.component';

interface UserProfileResponse {
  success: boolean;
  data: User & { branch?: { name: string; code: string } };
}

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    PageHeaderComponent,
  ],
  template: `
    <app-page-header title="My Profile" subtitle="View and update your account information"></app-page-header>

    <div class="p-6 max-w-4xl">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">

        <!-- Profile Card -->
        <div class="md:col-span-1">
          <div class="bg-white rounded-xl border border-slate-200 p-6 text-center">
            <div class="w-20 h-20 rounded-full bg-blue-600 flex items-center justify-center mx-auto mb-4">
              <span class="text-white text-3xl font-semibold">
                {{ user?.firstName?.charAt(0)?.toUpperCase() || 'U' }}
              </span>
            </div>
            <h3 class="text-lg font-semibold text-slate-800">{{ user?.firstName }} {{ user?.lastName }}</h3>
            <p class="text-sm text-slate-500 capitalize">{{ user?.role }}</p>
            <p class="text-sm text-slate-400 mt-1">{{ user?.email }}</p>

            <mat-divider class="my-4"></mat-divider>

            <div class="text-left space-y-3">
              <div class="flex items-center gap-3 text-sm">
                <mat-icon class="text-slate-400 text-lg">phone</mat-icon>
                <span class="text-slate-600">{{ user?.phone || 'Not set' }}</span>
              </div>
              <div class="flex items-center gap-3 text-sm">
                <mat-icon class="text-slate-400 text-lg">store</mat-icon>
                <span class="text-slate-600">{{ branchName || 'Not assigned' }}</span>
              </div>
              <div class="flex items-center gap-3 text-sm">
                <mat-icon class="text-slate-400 text-lg">badge</mat-icon>
                <span class="text-slate-600 capitalize">{{ user?.role || 'N/A' }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Forms -->
        <div class="md:col-span-2 space-y-6">

          <!-- Personal Info Form -->
          <div class="bg-white rounded-xl border border-slate-200 p-6">
            <h3 class="text-base font-semibold text-slate-800 mb-4">Personal Information</h3>
            <form [formGroup]="profileForm" (ngSubmit)="onUpdateProfile()">
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <mat-form-field appearance="outline">
                  <mat-label>First Name</mat-label>
                  <input matInput formControlName="firstName" />
                  <mat-error *ngIf="profileForm.get('firstName')?.hasError('required')">Required</mat-error>
                </mat-form-field>

                <mat-form-field appearance="outline">
                  <mat-label>Last Name</mat-label>
                  <input matInput formControlName="lastName" />
                  <mat-error *ngIf="profileForm.get('lastName')?.hasError('required')">Required</mat-error>
                </mat-form-field>
              </div>

              <mat-form-field appearance="outline" class="w-full">
                <mat-label>Email</mat-label>
                <input matInput formControlName="email" type="email" />
                <mat-error *ngIf="profileForm.get('email')?.hasError('required')">Required</mat-error>
                <mat-error *ngIf="profileForm.get('email')?.hasError('email')">Invalid email</mat-error>
              </mat-form-field>

              <mat-form-field appearance="outline" class="w-full">
                <mat-label>Phone</mat-label>
                <input matInput formControlName="phone" />
              </mat-form-field>

              <div class="flex justify-end">
                <button mat-raised-button color="primary" type="submit"
                        [disabled]="savingProfile || profileForm.invalid || profileForm.pristine">
                  <mat-spinner *ngIf="savingProfile" diameter="18" class="inline-block mr-2"></mat-spinner>
                  {{ savingProfile ? 'Saving...' : 'Save Changes' }}
                </button>
              </div>
            </form>
          </div>

          <!-- Change Password Form -->
          <div class="bg-white rounded-xl border border-slate-200 p-6">
            <h3 class="text-base font-semibold text-slate-800 mb-4">Change Password</h3>
            <form [formGroup]="passwordForm" (ngSubmit)="onChangePassword()">
              <mat-form-field appearance="outline" class="w-full">
                <mat-label>Current Password</mat-label>
                <input matInput formControlName="oldPassword" [type]="hideOld ? 'password' : 'text'" />
                <button type="button" mat-icon-button matSuffix (click)="hideOld = !hideOld">
                  <mat-icon>{{ hideOld ? 'visibility_off' : 'visibility' }}</mat-icon>
                </button>
                <mat-error *ngIf="passwordForm.get('oldPassword')?.hasError('required')">Required</mat-error>
              </mat-form-field>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <mat-form-field appearance="outline">
                  <mat-label>New Password</mat-label>
                  <input matInput formControlName="newPassword" [type]="hideNew ? 'password' : 'text'" />
                  <button type="button" mat-icon-button matSuffix (click)="hideNew = !hideNew">
                    <mat-icon>{{ hideNew ? 'visibility_off' : 'visibility' }}</mat-icon>
                  </button>
                  <mat-error *ngIf="passwordForm.get('newPassword')?.hasError('required')">Required</mat-error>
                  <mat-error *ngIf="passwordForm.get('newPassword')?.hasError('minlength')">Min 6 characters</mat-error>
                </mat-form-field>

                <mat-form-field appearance="outline">
                  <mat-label>Confirm Password</mat-label>
                  <input matInput formControlName="confirmPassword" [type]="hideConfirm ? 'password' : 'text'" />
                  <button type="button" mat-icon-button matSuffix (click)="hideConfirm = !hideConfirm">
                    <mat-icon>{{ hideConfirm ? 'visibility_off' : 'visibility' }}</mat-icon>
                  </button>
                  <mat-error *ngIf="passwordForm.get('confirmPassword')?.hasError('required')">Required</mat-error>
                  <mat-error *ngIf="passwordForm.get('confirmPassword')?.hasError('mismatch')">Passwords don't match</mat-error>
                </mat-form-field>
              </div>

              <div class="flex justify-end">
                <button mat-raised-button color="warn" type="submit"
                        [disabled]="savingPassword || passwordForm.invalid">
                  <mat-spinner *ngIf="savingPassword" diameter="18" class="inline-block mr-2"></mat-spinner>
                  {{ savingPassword ? 'Updating...' : 'Update Password' }}
                </button>
              </div>
            </form>
          </div>

        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .mat-mdc-form-field { margin-bottom: 4px; }
  `]
})
export class ProfileComponent implements OnInit {
  user: User | null = null;
  branchName = '';
  profileForm: FormGroup;
  passwordForm: FormGroup;
  savingProfile = false;
  savingPassword = false;
  hideOld = true;
  hideNew = true;
  hideConfirm = true;

  constructor(
    private fb: FormBuilder,
    private api: ApiService,
    private authService: AuthService,
    private notification: NotificationService
  ) {
    this.profileForm = this.fb.group({
      firstName: ['', Validators.required],
      lastName: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      phone: [''],
    });

    this.passwordForm = this.fb.group({
      oldPassword: ['', Validators.required],
      newPassword: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', Validators.required],
    });

    this.passwordForm.get('confirmPassword')?.addValidators(() => {
      const pw = this.passwordForm?.get('newPassword')?.value;
      const confirm = this.passwordForm?.get('confirmPassword')?.value;
      return pw && confirm && pw !== confirm ? { mismatch: true } : null;
    });
  }

  ngOnInit(): void {
    this.loadProfile();
  }

  loadProfile(): void {
    this.api.get<UserProfileResponse>('/users/me').subscribe({
      next: (res) => {
        const data = res.data;
        this.user = data;
        this.branchName = (data as any).branch?.name || '';
        this.profileForm.patchValue({
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          phone: data.phone || '',
        });
        this.profileForm.markAsPristine();
      },
      error: () => {
        this.notification.error('Failed to load profile');
      }
    });
  }

  onUpdateProfile(): void {
    if (this.profileForm.invalid) return;
    this.savingProfile = true;

    const values = this.profileForm.value;
    this.api.put<any>(`/users/${this.user?.id}`, values).subscribe({
      next: (res) => {
        this.savingProfile = false;
        this.notification.success('Profile updated');
        this.user = { ...this.user!, ...values };
        this.profileForm.markAsPristine();
        // Update the stored user in auth service
        const stored = localStorage.getItem('currentUser');
        if (stored) {
          const current = JSON.parse(stored);
          localStorage.setItem('currentUser', JSON.stringify({ ...current, ...values }));
        }
      },
      error: () => {
        this.savingProfile = false;
        this.notification.error('Failed to update profile');
      }
    });
  }

  onChangePassword(): void {
    if (this.passwordForm.invalid) return;

    const { newPassword, confirmPassword } = this.passwordForm.value;
    if (newPassword !== confirmPassword) {
      this.notification.error('Passwords do not match');
      return;
    }

    this.savingPassword = true;
    const { oldPassword } = this.passwordForm.value;

    this.api.post<any>('/auth/change-password', { oldPassword, newPassword }).subscribe({
      next: () => {
        this.savingPassword = false;
        this.notification.success('Password changed successfully');
        this.passwordForm.reset();
      },
      error: () => {
        this.savingPassword = false;
      }
    });
  }
}
