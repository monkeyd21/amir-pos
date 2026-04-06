import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { Toast, ToastService } from './toast.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './toast.component.html',
  styles: [`
    :host {
      position: fixed;
      bottom: 1.5rem;
      right: 1.5rem;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      pointer-events: none;
    }

    .toast-item {
      pointer-events: auto;
      animation: slideInRight 0.3s ease-out forwards;
    }

    .toast-item.removing {
      animation: slideOutRight 0.25s ease-in forwards;
    }

    @keyframes slideInRight {
      from {
        opacity: 0;
        transform: translateX(100%);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }

    @keyframes slideOutRight {
      from {
        opacity: 1;
        transform: translateX(0);
      }
      to {
        opacity: 0;
        transform: translateX(100%);
      }
    }
  `]
})
export class ToastComponent implements OnInit, OnDestroy {
  toasts: Toast[] = [];
  private sub!: Subscription;

  constructor(private toastService: ToastService) {}

  ngOnInit(): void {
    this.sub = this.toastService.toasts$.subscribe(toasts => {
      this.toasts = toasts;
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  dismiss(id: number): void {
    this.toastService.dismiss(id);
  }

  getIconForType(type: Toast['type']): string {
    switch (type) {
      case 'success': return 'check_circle';
      case 'error': return 'error';
      case 'warning': return 'warning';
      case 'info': return 'info';
    }
  }

  getToastClasses(type: Toast['type']): string {
    const base = 'toast-item';
    switch (type) {
      case 'success':
        return `${base} bg-emerald-900/80 border-emerald-500/30 text-emerald-200`;
      case 'error':
        return `${base} bg-red-900/80 border-error/30 text-on-error-container`;
      case 'warning':
        return `${base} bg-orange-900/80 border-tertiary/30 text-tertiary`;
      case 'info':
        return `${base} bg-primary-container/40 border-primary/30 text-primary`;
    }
  }
}
