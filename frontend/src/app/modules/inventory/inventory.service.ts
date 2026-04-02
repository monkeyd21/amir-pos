import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../core/services/api.service';

@Injectable({ providedIn: 'root' })
export class InventoryService {
  private api = inject(ApiService);

  getStockLevels(params?: any): Observable<any> {
    return this.api.get('/inventory/stock', params);
  }

  adjustStock(data: any): Observable<any> {
    return this.api.post('/inventory/adjustments', data);
  }

  getTransfers(params?: any): Observable<any> {
    return this.api.get('/inventory/transfers', params);
  }

  getTransferById(id: number): Observable<any> {
    return this.api.get(`/inventory/transfers/${id}`);
  }

  createTransfer(data: any): Observable<any> {
    return this.api.post('/inventory/transfers', data);
  }

  approveTransfer(id: number): Observable<any> {
    return this.api.patch(`/inventory/transfers/${id}/approve`, {});
  }

  receiveTransfer(id: number, data: any): Observable<any> {
    return this.api.patch(`/inventory/transfers/${id}/receive`, data);
  }

  getBranches(): Observable<any> {
    return this.api.get('/branches');
  }
}
