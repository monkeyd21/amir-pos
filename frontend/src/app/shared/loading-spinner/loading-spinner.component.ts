import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-loading-spinner',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './loading-spinner.component.html',
  styles: [`
    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .spinner-ring {
      animation: spin 0.8s linear infinite;
    }
  `]
})
export class LoadingSpinnerComponent {
  @Input() overlay = false;
  @Input() size: 'sm' | 'md' | 'lg' = 'md';
  @Input() message = '';

  get sizeClasses(): string {
    switch (this.size) {
      case 'sm': return 'w-5 h-5 border-2';
      case 'md': return 'w-8 h-8 border-[3px]';
      case 'lg': return 'w-12 h-12 border-4';
    }
  }
}
