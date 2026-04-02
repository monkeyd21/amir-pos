import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from '../../core/services/api.service';

@Injectable({ providedIn: 'root' })
export class EmployeeService {
  private api = inject(ApiService);

  getAll(params?: any): Observable<any> {
    return this.api.get<any>('/employees', params).pipe(map(res => res.data));
  }

  getById(id: number): Observable<any> {
    return this.api.get<any>(`/employees/${id}`).pipe(map(res => res.data));
  }

  create(data: any): Observable<any> {
    return this.api.post<any>('/users', data).pipe(map(res => res.data));
  }

  update(id: number, data: any): Observable<any> {
    return this.api.put<any>(`/employees/${id}`, data).pipe(map(res => res.data));
  }

  delete(id: number): Observable<any> {
    return this.api.delete<any>(`/employees/${id}`).pipe(map(res => res.data));
  }

  // Attendance
  getAttendance(params?: any): Observable<any> {
    return this.api.get<any>('/attendance', params).pipe(map(res => res.data));
  }

  clockIn(): Observable<any> {
    return this.api.post<any>('/attendance/clock-in', {}).pipe(map(res => res.data));
  }

  clockOut(): Observable<any> {
    return this.api.post<any>('/attendance/clock-out', {}).pipe(map(res => res.data));
  }

  getAttendanceSummary(employeeId: number, month: string): Observable<any> {
    return this.api.get<any>(`/attendance/summary/${employeeId}`, { month }).pipe(map(res => res.data));
  }

  // Commissions
  getCommissions(params?: any): Observable<any> {
    return this.api.get<any>('/commissions', params).pipe(map(res => res.data));
  }

  calculateCommissions(data: any): Observable<any> {
    return this.api.post<any>('/commissions/calculate', data).pipe(map(res => res.data));
  }

  payCommission(id: number): Observable<any> {
    return this.api.patch<any>(`/commissions/${id}/pay`, {}).pipe(map(res => res.data));
  }

  getCommissionSummary(params?: any): Observable<any> {
    return this.api.get<any>('/commissions/summary', params).pipe(map(res => res.data));
  }

  getBranches(): Observable<any> {
    return this.api.get<any>('/branches').pipe(map(res => res.data));
  }

  getRoles(): Observable<any> {
    return this.api.get<any>('/roles').pipe(map(res => res.data));
  }
}
