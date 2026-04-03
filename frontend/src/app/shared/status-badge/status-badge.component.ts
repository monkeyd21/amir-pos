import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-status-badge',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
          [ngClass]="statusClasses">
      <span class="w-1.5 h-1.5 rounded-full mr-1.5" [ngClass]="dotClasses"></span>
      {{ displayText }}
    </span>
  `,
})
export class StatusBadgeComponent {
  @Input() status = '';
  @Input() text = '';

  private static labels: Record<string, string> = {
    completed: 'Completed',
    refunded: 'Refunded',
    partially_returned: 'Partially Returned',
    partial_refund: 'Partial Refund',
    exchanged: 'Exchanged',
    pending: 'Pending',
    cancelled: 'Cancelled',
    active: 'Active',
    inactive: 'Inactive',
    approved: 'Approved',
    rejected: 'Rejected',
    paid: 'Paid',
    draft: 'Draft',
    open: 'Open',
    closed: 'Closed',
  };

  get displayText(): string {
    if (this.text) return this.text;
    return StatusBadgeComponent.labels[this.status] ||
      this.status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  get statusClasses(): Record<string, boolean> {
    const s = this.status.toLowerCase();
    return {
      'bg-green-50 text-green-700': s === 'completed' || s === 'active' || s === 'paid' || s === 'approved',
      'bg-orange-50 text-orange-700': s === 'partially_returned' || s === 'partial_refund',
      'bg-yellow-50 text-yellow-700': s === 'pending' || s === 'processing' || s === 'partial',
      'bg-red-50 text-red-700': s === 'cancelled' || s === 'failed' || s === 'rejected' || s === 'refunded',
      'bg-purple-50 text-purple-700': s === 'exchanged',
      'bg-blue-50 text-blue-700': s === 'draft' || s === 'new' || s === 'open',
      'bg-slate-50 text-slate-700': s === 'inactive' || s === 'closed',
    };
  }

  get dotClasses(): Record<string, boolean> {
    const s = this.status.toLowerCase();
    return {
      'bg-green-500': s === 'completed' || s === 'active' || s === 'paid' || s === 'approved',
      'bg-orange-500': s === 'partially_returned' || s === 'partial_refund',
      'bg-yellow-500': s === 'pending' || s === 'processing' || s === 'partial',
      'bg-red-500': s === 'cancelled' || s === 'failed' || s === 'rejected' || s === 'refunded',
      'bg-purple-500': s === 'exchanged',
      'bg-blue-500': s === 'draft' || s === 'new' || s === 'open',
      'bg-slate-500': s === 'inactive' || s === 'closed',
    };
  }
}
