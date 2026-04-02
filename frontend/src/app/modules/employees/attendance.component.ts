import { Component, OnInit, inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCardModule } from '@angular/material/card';
import { EmployeeService } from './employee.service';

@Component({
  selector: 'app-attendance',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatTableModule,
    MatPaginatorModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatCardModule,
  ],
  templateUrl: './attendance.component.html',
})
export class AttendanceComponent implements OnInit {
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  private employeeService = inject(EmployeeService);
  private snackBar = inject(MatSnackBar);

  displayedColumns = ['employee', 'date', 'clockIn', 'clockOut', 'hours', 'status'];
  dataSource = new MatTableDataSource<any>([]);
  loading = false;
  isClockedIn = false;
  currentClockIn: Date | null = null;

  selectedDate = new Date();
  employeeFilter = '';
  employees: any[] = [];

  ngOnInit(): void {
    this.loadAttendance();
    this.loadEmployees();
  }

  ngAfterViewInit(): void {
    this.dataSource.paginator = this.paginator;
  }

  loadAttendance(): void {
    this.loading = true;
    const params: any = { date: this.selectedDate.toISOString().split('T')[0] };
    if (this.employeeFilter) params.employeeId = this.employeeFilter;

    this.employeeService.getAttendance(params).subscribe({
      next: (res) => {
        this.dataSource.data = Array.isArray(res) ? res : [];
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      },
    });
  }

  loadEmployees(): void {
    this.employeeService.getAll().subscribe({
      next: (res) => (this.employees = Array.isArray(res) ? res : []),
    });
  }

  clockIn(): void {
    this.employeeService.clockIn().subscribe({
      next: () => {
        this.isClockedIn = true;
        this.currentClockIn = new Date();
        this.snackBar.open('Clocked in successfully', 'Close', { duration: 2000 });
        this.loadAttendance();
      },
      error: () => {
        this.snackBar.open('Failed to clock in', 'Close', { duration: 3000 });
      },
    });
  }

  clockOut(): void {
    this.employeeService.clockOut().subscribe({
      next: () => {
        this.isClockedIn = false;
        this.snackBar.open('Clocked out successfully', 'Close', { duration: 2000 });
        this.loadAttendance();
      },
      error: () => {
        this.snackBar.open('Failed to clock out', 'Close', { duration: 3000 });
      },
    });
  }
}
