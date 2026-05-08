import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { AutoCapsDirective } from '../../shared/directives/auto-caps.directive';

interface VendorSummary {
  id: number;
  name: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  paymentTerms?: string | null;
}

interface LedgerSummary {
  totalPurchased: number;
  totalCreditPurchased: number;
  totalPaid: number;
  balanceOwed: number;
  purchaseCount: number;
  paymentCount: number;
}

interface LedgerMovement {
  id: number;
  createdAt: string;
  productName: string;
  sku: string;
  size: string;
  color: string;
  quantity: number;
  unitCost: number | null;
  lineCost: number | null;
  paymentMode: 'cash' | 'credit' | null;
  dueDate: string | null;
  lotCode: string | null;
}

interface LedgerPayment {
  id: number;
  amount: number;
  method: string;
  reference: string | null;
  paymentDate: string;
  createdBy: string;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

@Component({
  selector: 'app-vendor-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    PageHeaderComponent,
    AutoCapsDirective,
  ],
  templateUrl: './vendor-detail.component.html',
})
export class VendorDetailComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  vendorId!: number;
  vendor: VendorSummary | null = null;
  summary: LedgerSummary | null = null;
  movements: LedgerMovement[] = [];
  payments: LedgerPayment[] = [];
  loading = true;

  // Inline payment form
  paymentOpen = false;
  paymentAmount: number | null = null;
  paymentMethod: 'cash' | 'bank_transfer' | 'upi' | 'cheque' = 'cash';
  paymentReference = '';
  paymentNotes = '';
  paymentDate = new Date().toISOString().slice(0, 10);
  recording = false;

  constructor(
    private api: ApiService,
    private notification: NotificationService,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.vendorId = Number(this.route.snapshot.paramMap.get('id'));
    this.loadLedger();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadLedger(): void {
    this.loading = true;
    this.api
      .get<ApiResponse<{
        vendor: VendorSummary;
        summary: LedgerSummary;
        movements: LedgerMovement[];
        payments: LedgerPayment[];
      }>>(`/vendors/${this.vendorId}/ledger`)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.vendor = res.data.vendor;
          this.summary = res.data.summary;
          this.movements = res.data.movements;
          this.payments = res.data.payments;
          this.loading = false;
        },
        error: () => {
          this.loading = false;
        },
      });
  }

  openPaymentForm(): void {
    this.paymentAmount = this.summary?.balanceOwed ?? null;
    this.paymentReference = '';
    this.paymentNotes = '';
    this.paymentDate = new Date().toISOString().slice(0, 10);
    this.paymentOpen = true;
  }

  cancelPayment(): void {
    this.paymentOpen = false;
  }

  submitPayment(): void {
    if (!this.paymentAmount || this.paymentAmount <= 0 || this.recording) return;
    this.recording = true;
    this.api
      .post<ApiResponse<unknown>>(`/vendors/${this.vendorId}/payments`, {
        amount: Number(this.paymentAmount),
        method: this.paymentMethod,
        reference: this.paymentReference.trim() || undefined,
        notes: this.paymentNotes.trim() || undefined,
        paymentDate: new Date(this.paymentDate).toISOString(),
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.recording = false;
          this.paymentOpen = false;
          this.notification.success('Payment recorded');
          this.loadLedger();
        },
        error: () => {
          this.recording = false;
        },
      });
  }
}
