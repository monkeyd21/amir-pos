import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from '../../core/services/api.service';

@Injectable({ providedIn: 'root' })
export class AccountingService {
  private api = inject(ApiService);

  getJournalEntries(params?: any): Observable<any> {
    return this.api.get<any>('/accounting/journal-entries', params).pipe(map(res => res.data));
  }

  createJournalEntry(data: any): Observable<any> {
    return this.api.post<any>('/accounting/journal-entries', data).pipe(map(res => res.data));
  }

  getLedger(params?: any): Observable<any> {
    return this.api.get<any>('/accounting/ledger', params).pipe(map(res => res.data));
  }

  getAccounts(): Observable<any> {
    return this.api.get<any>('/accounting/accounts').pipe(map(res => res.data));
  }

  getProfitAndLoss(params?: any): Observable<any> {
    return this.api.get<any>('/accounting/pnl', params).pipe(map(res => res.data));
  }

  getBalanceSheet(params?: any): Observable<any> {
    return this.api.get<any>('/accounting/balance-sheet', params).pipe(map(res => res.data));
  }
}
