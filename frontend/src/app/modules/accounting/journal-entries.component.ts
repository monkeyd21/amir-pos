import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { LoadingSpinnerComponent } from '../../shared/loading-spinner/loading-spinner.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';

interface JournalEntry {
  id: number;
  entryNumber: string;
  date: string;
  description: string;
  accounts: { name: string; debit: number; credit: number }[];
  totalAmount: number;
  status: string;
  createdBy?: string;
}

interface JournalEntriesResponse {
  success: boolean;
  data: JournalEntry[];
}

@Component({
  selector: 'app-journal-entries',
  standalone: true,
  imports: [CommonModule, RouterModule, PageHeaderComponent, LoadingSpinnerComponent, EmptyStateComponent],
  templateUrl: './journal-entries.component.html',
})
export class JournalEntriesComponent implements OnInit {
  entries: JournalEntry[] = [];
  loading = false;
  showNewEntryForm = false;

  constructor(
    private api: ApiService,
    private notification: NotificationService,
  ) {}

  ngOnInit(): void {
    this.loadEntries();
  }

  loadEntries(): void {
    this.loading = true;
    this.api.get<JournalEntriesResponse>('/accounting/journal-entries').subscribe({
      next: (res) => {
        this.entries = res.data || [];
        this.loading = false;
      },
      error: () => {
        this.entries = [];
        this.loading = false;
      },
    });
  }

  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(amount);
  }

  formatDate(date: string): string {
    return new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  getAccountsSummary(entry: JournalEntry): string {
    if (!entry.accounts || entry.accounts.length === 0) return '-';
    const names = entry.accounts.map((a) => a.name);
    if (names.length <= 2) return names.join(', ');
    return `${names[0]}, ${names[1]} +${names.length - 2} more`;
  }

  getStatusClasses(status: string): string {
    switch (status?.toLowerCase()) {
      case 'posted':
      case 'approved':
        return 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20';
      case 'draft':
        return 'bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20';
      case 'voided':
      case 'cancelled':
        return 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20';
      default:
        return 'bg-surface-container-high text-on-surface-variant ring-1 ring-outline-variant/20';
    }
  }

  formatStatus(status: string): string {
    if (!status) return '';
    return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  toggleNewEntry(): void {
    this.showNewEntryForm = !this.showNewEntryForm;
    if (!this.showNewEntryForm) {
      this.notification.info('New entry form coming soon');
    }
  }
}
