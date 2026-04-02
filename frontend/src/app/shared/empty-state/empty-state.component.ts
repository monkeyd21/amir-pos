import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule],
  template: `
    <div class="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div class="w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center mb-4">
        <mat-icon class="text-4xl text-slate-300">{{ icon }}</mat-icon>
      </div>
      <h3 class="text-lg font-semibold text-slate-700">{{ title }}</h3>
      <p class="text-sm text-slate-400 mt-1 max-w-sm">{{ message }}</p>
      <ng-content></ng-content>
    </div>
  `,
})
export class EmptyStateComponent {
  @Input() icon = 'inbox';
  @Input() title = 'No data found';
  @Input() message = 'There are no items to display at the moment.';
}
