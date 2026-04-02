import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
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
    return this.api.get<any>(`/pos/lookup/${barcode}`).pipe(map(res => res.data));
  }

  checkout(payload: CheckoutPayload): Observable<any> {
    return this.api.post<any>('/pos/checkout', payload).pipe(map(res => res.data));
  }

  holdTransaction(transaction: any): Observable<any> {
    return this.api.post<any>('/pos/hold', transaction).pipe(map(res => res.data));
  }

  getHeldTransactions(): Observable<any> {
    return this.api.get<any>('/pos/held').pipe(map(res => res.data));
  }

  resumeTransaction(id: string): Observable<any> {
    return this.api.get<any>(`/pos/held/${id}`).pipe(map(res => res.data));
  }

  deleteHeldTransaction(id: string): Observable<any> {
    return this.api.delete<any>(`/pos/held/${id}`).pipe(map(res => res.data));
  }

  openSession(): Observable<any> {
    return this.api.post<any>('/pos/sessions/open', {}).pipe(map(res => res.data));
  }

  closeSession(data: any): Observable<any> {
    return this.api.post<any>('/pos/sessions/close', data).pipe(map(res => res.data));
  }

  getSession(): Observable<any> {
    return this.api.get<any>('/pos/sessions/current').pipe(map(res => res.data));
  }

  searchCustomer(query: string): Observable<any> {
    return this.api.get<any>('/customers/search', { query }).pipe(map(res => res.data));
  }
}
