import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

@Component({
  selector: 'app-loading-spinner',
  standalone: true,
  imports: [CommonModule, MatProgressSpinnerModule],
  template: `
    <div class="flex flex-col items-center justify-center py-12" [class.min-h-screen]="fullScreen">
      <mat-spinner [diameter]="diameter" color="primary"></mat-spinner>
      <p *ngIf="message" class="mt-4 text-sm text-slate-500">{{ message }}</p>
    </div>
  `,
})
export class LoadingSpinnerComponent {
  @Input() message = '';
  @Input() diameter = 40;
  @Input() fullScreen = false;
}
