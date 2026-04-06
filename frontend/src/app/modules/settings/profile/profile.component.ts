import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PageHeaderComponent } from '../../../shared/page-header/page-header.component';
import { ApiService } from '../../../core/services/api.service';
import { AuthService, User } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, PageHeaderComponent],
  templateUrl: './profile.component.html',
})
export class ProfileComponent implements OnInit {
  // Personal info
  firstName = '';
  lastName = '';
  email = '';
  phone = '';
  savingProfile = false;

  // Password
  currentPassword = '';
  newPassword = '';
  confirmPassword = '';
  savingPassword = false;
  showCurrentPassword = false;
  showNewPassword = false;

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private notification: NotificationService,
  ) {}

  ngOnInit(): void {
    const user = this.auth.getCurrentUser();
    if (user) {
      this.firstName = user.firstName || '';
      this.lastName = user.lastName || '';
      this.email = user.email || '';
      this.phone = user.phone || '';
    }
  }

  saveProfile(): void {
    if (!this.firstName.trim() || !this.lastName.trim()) {
      this.notification.error('First name and last name are required');
      return;
    }
    this.savingProfile = true;
    this.api
      .put<{ success: boolean; data: User }>('/users/profile', {
        firstName: this.firstName.trim(),
        lastName: this.lastName.trim(),
        phone: this.phone.trim(),
      })
      .subscribe({
        next: () => {
          this.notification.success('Profile updated successfully');
          this.savingProfile = false;
        },
        error: (err) => {
          this.notification.error(err.error?.error || 'Failed to update profile');
          this.savingProfile = false;
        },
      });
  }

  changePassword(): void {
    if (!this.currentPassword) {
      this.notification.error('Current password is required');
      return;
    }
    if (this.newPassword.length < 6) {
      this.notification.error('New password must be at least 6 characters');
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      this.notification.error('Passwords do not match');
      return;
    }
    this.savingPassword = true;
    this.api
      .put<{ success: boolean }>('/users/change-password', {
        currentPassword: this.currentPassword,
        newPassword: this.newPassword,
      })
      .subscribe({
        next: () => {
          this.notification.success('Password changed successfully');
          this.currentPassword = '';
          this.newPassword = '';
          this.confirmPassword = '';
          this.savingPassword = false;
        },
        error: (err) => {
          this.notification.error(err.error?.error || 'Failed to change password');
          this.savingPassword = false;
        },
      });
  }

  get initials(): string {
    return (this.firstName.charAt(0) + this.lastName.charAt(0)).toUpperCase();
  }
}
