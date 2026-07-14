import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';

/**
 * §6 — Child Birthdays (Marketing) report. Lists customers whose child has a
 * birthday in the selected month, for SMS/WhatsApp outreach. Reads
 * GET /reports/child-birthdays?month=MM. Month defaults to the current month.
 */
interface BirthdayCustomer {
  id: number;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  childBirthMonth: number | null;
}

@Component({
  selector: 'app-child-birthday-report',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PageHeaderComponent],
  templateUrl: './child-birthday-report.component.html',
})
export class ChildBirthdayReportComponent implements OnInit {
  loading = false;
  month = new Date().getMonth() + 1; // 1-12
  count = 0;
  customers: BirthdayCustomer[] = [];

  readonly months = [
    { value: 1, label: 'January' },
    { value: 2, label: 'February' },
    { value: 3, label: 'March' },
    { value: 4, label: 'April' },
    { value: 5, label: 'May' },
    { value: 6, label: 'June' },
    { value: 7, label: 'July' },
    { value: 8, label: 'August' },
    { value: 9, label: 'September' },
    { value: 10, label: 'October' },
    { value: 11, label: 'November' },
    { value: 12, label: 'December' },
  ];

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.api.get<any>('/reports/child-birthdays', { month: this.month }).subscribe({
      next: (res) => {
        this.count = res?.data?.count ?? 0;
        this.customers = res?.data?.customers ?? [];
        this.loading = false;
      },
      error: () => {
        this.customers = [];
        this.count = 0;
        this.loading = false;
      },
    });
  }

  monthLabel(m: number | null | undefined): string {
    const found = this.months.find((x) => x.value === m);
    return found ? found.label : '—';
  }

  customerName(c: BirthdayCustomer): string {
    return `${c.firstName || ''} ${c.lastName || ''}`.trim() || '—';
  }
}
