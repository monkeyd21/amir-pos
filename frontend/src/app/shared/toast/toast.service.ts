import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
  duration: number;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private toasts: Toast[] = [];
  private toastsSubject = new BehaviorSubject<Toast[]>([]);
  toasts$ = this.toastsSubject.asObservable();
  private nextId = 0;

  success(message: string, duration = 4000): void { this.add(message, 'success', duration); }
  error(message: string, duration = 6000): void { this.add(message, 'error', duration); }
  warning(message: string, duration = 5000): void { this.add(message, 'warning', duration); }
  info(message: string, duration = 4000): void { this.add(message, 'info', duration); }

  dismiss(id: number): void {
    this.toasts = this.toasts.filter(t => t.id !== id);
    this.toastsSubject.next([...this.toasts]);
  }

  private add(message: string, type: Toast['type'], duration: number): void {
    const toast: Toast = { id: ++this.nextId, message, type, duration };
    this.toasts.push(toast);
    this.toastsSubject.next([...this.toasts]);
    if (duration > 0) setTimeout(() => this.dismiss(toast.id), duration);
  }
}
