import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from '../../core/services/api.service';

@Injectable({ providedIn: 'root' })
export class InventoryService {
  private api = inject(ApiService);

  getStockLevels(params?: any): Observable<any> {
    return this.api.get<any>('/inventory/stock', params).pipe(map(res => res.data));
  }

  adjustStock(data: any): Observable<any> {
    return this.api.post<any>('/inventory/adjustments', data).pipe(map(res => res.data));
  }

  getTransfers(params?: any): Observable<any> {
    return this.api.get<any>('/inventory/transfers', params).pipe(map(res => res.data));
  }

  getTransferById(id: number): Observable<any> {
    return this.api.get<any>(`/inventory/transfers/${id}`).pipe(map(res => res.data));
  }

  createTransfer(data: any): Observable<any> {
    return this.api.post<any>('/inventory/transfers', data).pipe(map(res => res.data));
  }

  approveTransfer(id: number): Observable<any> {
    return this.api.patch<any>(`/inventory/transfers/${id}/approve`, {}).pipe(map(res => res.data));
  }

  receiveTransfer(id: number, data: any): Observable<any> {
    return this.api.patch<any>(`/inventory/transfers/${id}/receive`, data).pipe(map(res => res.data));
  }

  getBranches(): Observable<any> {
    return this.api.get<any>('/branches').pipe(map(res => res.data));
  }
}
