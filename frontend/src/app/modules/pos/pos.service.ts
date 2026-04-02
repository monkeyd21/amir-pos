import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../core/services/api.service';

export interface CartItem {
  productId: number;
  variantId: number;
  barcode: string;
  name: string;
  variant: string;
  size: string;
  color: string;
  unitPrice: number;
  quantity: number;
  discount: number;
  total: number;
}

export interface HeldTransaction {
  id: string;
  items: CartItem[];
  customerId?: number;
  customerName?: string;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  heldAt: Date;
  note?: string;
}

export interface PaymentLine {
  method: 'cash' | 'card' | 'upi';
  amount: number;
  reference?: string;
}

export interface CheckoutPayload {
  items: CartItem[];
  customerId?: number;
  payments: PaymentLine[];
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  loyaltyPointsRedeemed?: number;
}

@Injectable({ providedIn: 'root' })
export class PosService {
  private api = inject(ApiService);

  lookupBarcode(barcode: string): Observable<any> {
    return this.api.get(`/pos/lookup/${barcode}`);
  }

  checkout(payload: CheckoutPayload): Observable<any> {
    return this.api.post('/pos/checkout', payload);
  }

  holdTransaction(transaction: any): Observable<any> {
    return this.api.post('/pos/hold', transaction);
  }

  getHeldTransactions(): Observable<any> {
    return this.api.get('/pos/held');
  }

  resumeTransaction(id: string): Observable<any> {
    return this.api.get(`/pos/held/${id}`);
  }

  deleteHeldTransaction(id: string): Observable<any> {
    return this.api.delete(`/pos/held/${id}`);
  }

  openSession(): Observable<any> {
    return this.api.post('/pos/sessions/open', {});
  }

  closeSession(data: any): Observable<any> {
    return this.api.post('/pos/sessions/close', data);
  }

  getSession(): Observable<any> {
    return this.api.get('/pos/sessions/current');
  }

  searchCustomer(query: string): Observable<any> {
    return this.api.get('/customers/search', { query });
  }
}
