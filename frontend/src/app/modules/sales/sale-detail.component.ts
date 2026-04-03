import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { SalesService } from './sales.service';
import { ReturnDialogComponent } from './return-dialog.component';
import { ExchangeDialogComponent } from './exchange-dialog.component';

@Component({
  selector: 'app-sale-detail',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatDividerModule,
    MatChipsModule,
    MatDialogModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './sale-detail.component.html',
})
export class SaleDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private salesService = inject(SalesService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);

  sale: any = null;
  loading = true;
  itemColumns = ['product', 'variant', 'quantity', 'returned', 'unitPrice', 'total'];
  paymentColumns = ['method', 'amount', 'reference'];

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadSale(id);
    } else {
      this.loading = false;
    }
  }

  loadSale(id: string | number): void {
    this.loading = true;
    this.salesService.getById(id).subscribe({
      next: (res) => {
        this.sale = res.data || res;
        this.loading = false;
      },
      error: () => {
        this.snackBar.open('Failed to load sale', 'Close', { duration: 3000 });
        this.loading = false;
      },
    });
  }

  goBack(): void {
    this.router.navigate(['/sales']);
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-700';
      case 'refunded': return 'bg-red-100 text-red-700';
      case 'partially_returned': return 'bg-orange-100 text-orange-700';
      case 'partial_refund': return 'bg-orange-100 text-orange-700';
      case 'exchanged': return 'bg-purple-100 text-purple-700';
      case 'pending': return 'bg-yellow-100 text-yellow-700';
      case 'cancelled': return 'bg-slate-100 text-slate-500';
      default: return 'bg-slate-100 text-slate-700';
    }
  }

  formatStatus(status: string): string {
    const labels: Record<string, string> = {
      completed: 'Completed',
      refunded: 'Refunded',
      partially_returned: 'Partially Returned',
      partial_refund: 'Partial Refund',
      exchanged: 'Exchanged',
      pending: 'Pending',
      cancelled: 'Cancelled',
    };
    return labels[status] || status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  openReturnDialog(): void {
    const dialogRef = this.dialog.open(ReturnDialogComponent, {
      width: '600px',
      maxHeight: '90vh',
      data: { sale: this.sale },
    });
    dialogRef.afterClosed().subscribe((result) => {
      if (result) this.loadSale(this.sale.id);
    });
  }

  openExchangeDialog(): void {
    const dialogRef = this.dialog.open(ExchangeDialogComponent, {
      width: '700px',
      maxHeight: '90vh',
      data: { sale: this.sale },
    });
    dialogRef.afterClosed().subscribe((result) => {
      if (result) this.loadSale(this.sale.id);
    });
  }
}
