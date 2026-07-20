import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { NotificationService } from '../../core/services/notification.service';

interface ReportCard {
  icon: string;
  title: string;
  description: string;
  gradient: string;
  iconBg: string;
  iconColor: string;
  /** When set, the card links to a real report route instead of "coming soon". */
  route?: string;
}

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [CommonModule, RouterLink, PageHeaderComponent],
  templateUrl: './reports.component.html',
})
export class ReportsComponent {
  reports: ReportCard[] = [
    {
      icon: 'history',
      title: 'Historical Sales (Archive)',
      description: 'Migrated legacy bills — totals by fiscal year and month, cash vs card. Read-only archive, separate from live sales.',
      gradient: 'from-amber-500/20 to-orange-500/20',
      iconBg: 'bg-gradient-to-br from-amber-500 to-orange-500',
      iconColor: 'text-white',
      route: '/reports/historical',
    },
    {
      icon: 'balance',
      title: 'Variance Report',
      description: 'Daily & monthly EOD reconciliation variance — Cash, UPI and Card tracked separately, with PIN-override history and largest-variance days (§8.4).',
      gradient: 'from-rose-500/20 to-red-500/20',
      iconBg: 'bg-gradient-to-br from-rose-500 to-red-500',
      iconColor: 'text-white',
      route: '/reports/variance',
    },
    {
      icon: 'cake',
      title: 'Child Birthdays (Marketing)',
      description: 'Customers whose child has a birthday this month — for SMS / WhatsApp birthday outreach and offers (§6).',
      gradient: 'from-fuchsia-500/20 to-pink-500/20',
      iconBg: 'bg-gradient-to-br from-fuchsia-500 to-pink-500',
      iconColor: 'text-white',
      route: '/reports/child-birthdays',
    },
    {
      icon: 'point_of_sale',
      title: 'Sales Report',
      description: 'Analyze sales trends, top-selling products, revenue by period, and payment method breakdowns.',
      gradient: 'from-blue-500/20 to-indigo-500/20',
      iconBg: 'bg-gradient-to-br from-blue-500 to-indigo-500',
      iconColor: 'text-white',
    },
    {
      icon: 'inventory_2',
      title: 'Inventory Report',
      description: 'Track stock levels, product movement, low-stock alerts, and inventory valuation across branches.',
      gradient: 'from-emerald-500/20 to-teal-500/20',
      iconBg: 'bg-gradient-to-br from-emerald-500 to-teal-500',
      iconColor: 'text-white',
    },
    {
      icon: 'group',
      title: 'Customer Report',
      description: 'Customer acquisition, purchase history, loyalty metrics, and lifetime value analysis.',
      gradient: 'from-violet-500/20 to-purple-500/20',
      iconBg: 'bg-gradient-to-br from-violet-500 to-purple-500',
      iconColor: 'text-white',
    },
    {
      icon: 'account_balance',
      title: 'Profit & Loss',
      description: 'Revenue, expenses and net income for the day (default), or by week / month / quarter / year and custom date range.',
      gradient: 'from-amber-500/20 to-orange-500/20',
      iconBg: 'bg-gradient-to-br from-amber-500 to-orange-500',
      iconColor: 'text-white',
      route: '/reports/pnl',
    },
    {
      icon: 'badge',
      title: 'Employee Report',
      description: 'Staff performance, attendance records, commission tracking, and payroll summaries.',
      gradient: 'from-pink-500/20 to-rose-500/20',
      iconBg: 'bg-gradient-to-br from-pink-500 to-rose-500',
      iconColor: 'text-white',
    },
    {
      icon: 'local_shipping',
      title: 'Stock Transfer Report',
      description: 'Inter-branch transfers, transit status, transfer history, and fulfillment rates.',
      gradient: 'from-cyan-500/20 to-sky-500/20',
      iconBg: 'bg-gradient-to-br from-cyan-500 to-sky-500',
      iconColor: 'text-white',
    },
  ];

  activeReport: string | null = null;

  constructor(private notification: NotificationService) {}

  generateReport(report: ReportCard): void {
    this.activeReport = report.title;
    this.notification.info(`${report.title} generation coming soon`);
    setTimeout(() => {
      this.activeReport = null;
    }, 2000);
  }
}
