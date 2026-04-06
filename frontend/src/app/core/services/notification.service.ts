import { Injectable } from '@angular/core';
import { ToastService } from '../../shared/toast/toast.service';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  constructor(private toast: ToastService) {}

  success(message: string, duration = 3000): void {
    this.toast.success(message, duration);
  }

  error(message: string, duration = 5000): void {
    this.toast.error(message, duration);
  }

  warning(message: string, duration = 4000): void {
    this.toast.warning(message, duration);
  }

  info(message: string, duration = 3000): void {
    this.toast.info(message, duration);
  }
}
