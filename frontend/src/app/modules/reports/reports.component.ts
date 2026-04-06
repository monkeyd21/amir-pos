import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { NotificationService } from '../../core/services/notification.service';

interface ReportCard {
  icon: string;
  title: string;
  description: string;
  gradient: string;
  iconBg: string;
  iconColor: string;
}

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [CommonModule, PageHeaderComponent],
  templateUrl: './reports.component.html',
})
export class ReportsComponent {
  reports: ReportCard[] = [
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
      title: 'Financial Report',
      description: 'Revenue summaries, expense tracking, profit margins, and cash flow statements.',
      gradient: 'from-amber-500/20 to-orange-500/20',
      iconBg: 'bg-gradient-to-br from-amber-500 to-orange-500',
      iconColor: 'text-white',
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
