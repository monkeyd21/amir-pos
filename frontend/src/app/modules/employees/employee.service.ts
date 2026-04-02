import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../core/services/api.service';

@Injectable({ providedIn: 'root' })
export class EmployeeService {
  private api = inject(ApiService);

  getAll(params?: any): Observable<any> {
    return this.api.get('/employees', params);
  }

  getById(id: number): Observable<any> {
    return this.api.get(`/employees/${id}`);
  }

  create(data: any): Observable<any> {
    return this.api.post('/employees', data);
  }

  update(id: number, data: any): Observable<any> {
    return this.api.put(`/employees/${id}`, data);
  }

  delete(id: number): Observable<any> {
    return this.api.delete(`/employees/${id}`);
  }

  // Attendance
  getAttendance(params?: any): Observable<any> {
    return this.api.get('/attendance', params);
  }

  clockIn(): Observable<any> {
    return this.api.post('/attendance/clock-in', {});
  }

  clockOut(): Observable<any> {
    return this.api.post('/attendance/clock-out', {});
  }

  getAttendanceSummary(employeeId: number, month: string): Observable<any> {
    return this.api.get(`/attendance/summary/${employeeId}`, { month });
  }

  // Commissions
  getCommissions(params?: any): Observable<any> {
    return this.api.get('/commissions', params);
  }

  calculateCommissions(data: any): Observable<any> {
    return this.api.post('/commissions/calculate', data);
  }

  payCommission(id: number): Observable<any> {
    return this.api.patch(`/commissions/${id}/pay`, {});
  }

  getCommissionSummary(params?: any): Observable<any> {
    return this.api.get('/commissions/summary', params);
  }

  getBranches(): Observable<any> {
    return this.api.get('/branches');
  }

  getRoles(): Observable<any> {
    return this.api.get('/roles');
  }
}
