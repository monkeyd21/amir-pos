import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-status-badge',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './status-badge.component.html',
})
export class StatusBadgeComponent {
  @Input() status = '';

  formatStatus(value: string): string {
    if (!value) return '';
    return value
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  get badgeClasses(): string {
    const s = this.status?.toLowerCase() || '';
    switch (s) {
      case 'completed':
      case 'paid':
        return 'bg-primary/20 text-primary';
      case 'pending':
      case 'processing':
        return 'bg-tertiary/20 text-tertiary';
      case 'cancelled':
      case 'failed':
        return 'bg-error-container/40 text-on-error-container';
      case 'shipped':
      case 'active':
        return 'bg-secondary-container/40 text-on-secondary-container';
      case 'returned':
      case 'partially_returned':
        return 'bg-amber-500/20 text-amber-400';
      case 'draft':
        return 'bg-outline-variant/20 text-on-surface-variant';
      default:
        return 'bg-outline-variant/20 text-on-surface-variant';
    }
  }
}
