import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from '../../core/services/api.service';

@Injectable({ providedIn: 'root' })
export class ReportsService {
  private api = inject(ApiService);

  getSalesReport(params?: any): Observable<any> {
    return this.api.get<any>('/reports/sales', params).pipe(map(res => res.data));
  }

  getInventoryReport(params?: any): Observable<any> {
    return this.api.get<any>('/reports/inventory', params).pipe(map(res => res.data));
  }

  getCustomerReport(params?: any): Observable<any> {
    return this.api.get<any>('/reports/customers', params).pipe(map(res => res.data));
  }

  getExpenseReport(params?: any): Observable<any> {
    return this.api.get<any>('/reports/expenses', params).pipe(map(res => res.data));
  }

  getEmployeeReport(params?: any): Observable<any> {
    return this.api.get<any>('/reports/employees', params).pipe(map(res => res.data));
  }

  getDashboardStats(): Observable<any> {
    return this.api.get<any>('/reports/dashboard').pipe(map(res => res.data));
  }
}
