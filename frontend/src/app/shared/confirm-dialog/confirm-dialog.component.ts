import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info';
}

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <div class="p-6 max-w-md">
      <div class="flex items-start gap-4">
        <div class="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
             [ngClass]="{
               'bg-red-100': data.type === 'danger',
               'bg-amber-100': data.type === 'warning',
               'bg-blue-100': data.type === 'info' || !data.type
             }">
          <mat-icon [ngClass]="{
               'text-red-600': data.type === 'danger',
               'text-amber-600': data.type === 'warning',
               'text-blue-600': data.type === 'info' || !data.type
             }">
            {{ data.type === 'danger' ? 'warning' : data.type === 'warning' ? 'info' : 'help_outline' }}
          </mat-icon>
        </div>
        <div>
          <h2 class="text-lg font-semibold text-slate-800">{{ data.title }}</h2>
          <p class="mt-2 text-sm text-slate-500">{{ data.message }}</p>
        </div>
      </div>

      <div class="flex justify-end gap-3 mt-6">
        <button mat-button (click)="onCancel()" class="text-slate-500">
          {{ data.cancelText || 'Cancel' }}
        </button>
        <button mat-raised-button
                [color]="data.type === 'danger' ? 'warn' : 'primary'"
                (click)="onConfirm()">
          {{ data.confirmText || 'Confirm' }}
        </button>
      </div>
    </div>
  `,
})
export class ConfirmDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<ConfirmDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ConfirmDialogData
  ) {}

  onConfirm(): void {
    this.dialogRef.close(true);
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }
}
