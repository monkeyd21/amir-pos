import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogRef } from '../dialog/dialog-ref';
import { DIALOG_DATA } from '../dialog/dialog.tokens';

export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmStyle?: 'danger' | 'primary';
}

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './confirm-dialog.component.html',
})
export class ConfirmDialogComponent {
  constructor(
    public dialogRef: DialogRef<boolean>,
    @Inject(DIALOG_DATA) public data: ConfirmDialogData
  ) {}

  get confirmText(): string {
    return this.data.confirmText || 'Confirm';
  }

  get cancelText(): string {
    return this.data.cancelText || 'Cancel';
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onConfirm(): void {
    this.dialogRef.close(true);
  }
}
