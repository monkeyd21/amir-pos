import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';

interface AttendanceRecord {
  id: number;
  employee: {
    id: number;
    firstName: string;
    lastName: string;
    role: string;
  };
  date: string;
  checkIn?: string;
  checkOut?: string;
  status: string;
  hoursWorked?: number;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: any;
}

@Component({
  selector: 'app-attendance',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './attendance.component.html',
})
export class AttendanceComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  records: AttendanceRecord[] = [];
  loading = true;
  clockingIn = false;
  clockingOut = false;
  selectedDate: string = new Date().toISOString().split('T')[0];

  constructor(
    private api: ApiService,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.loadAttendance();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadAttendance(): void {
    this.loading = true;
    this.api
      .get<ApiResponse<AttendanceRecord[]>>('/employees/attendance', {
        date: this.selectedDate,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.records = res.data || [];
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.records = [];
          this.notify.error('Failed to load attendance');
        },
      });
  }

  onDateChange(): void {
    this.loadAttendance();
  }

  clockIn(): void {
    if (this.clockingIn) return;
    this.clockingIn = true;
    this.api
      .post<ApiResponse<any>>('/employees/attendance/clock-in', { branchId: 1 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.clockingIn = false;
          this.notify.success('Clocked in successfully');
          this.loadAttendance();
        },
        error: (err) => {
          this.clockingIn = false;
          this.notify.error(err.error?.error || 'Failed to clock in');
        },
      });
  }

  clockOut(): void {
    if (this.clockingOut) return;
    this.clockingOut = true;
    this.api
      .post<ApiResponse<any>>('/employees/attendance/clock-out', {})
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.clockingOut = false;
          this.notify.success('Clocked out successfully');
          this.loadAttendance();
        },
        error: (err) => {
          this.clockingOut = false;
          this.notify.error(err.error?.error || 'Failed to clock out');
        },
      });
  }

  getStatusClasses(status: string): string {
    switch (status?.toLowerCase()) {
      case 'present':
        return 'bg-green-500/10 text-green-400';
      case 'absent':
        return 'bg-red-500/10 text-red-400';
      case 'late':
        return 'bg-yellow-500/10 text-yellow-400';
      case 'half_day':
        return 'bg-orange-500/10 text-orange-400';
      default:
        return 'bg-surface-variant/30 text-on-surface-variant';
    }
  }

  formatStatus(status: string): string {
    return status
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }

  formatTime(time?: string): string {
    if (!time) return '---';
    try {
      return new Date(time).toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return time;
    }
  }

  countByStatus(status: string): number {
    return this.records.filter(
      (r) => r.status?.toLowerCase() === status.toLowerCase()
    ).length;
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-IN', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  }
}
