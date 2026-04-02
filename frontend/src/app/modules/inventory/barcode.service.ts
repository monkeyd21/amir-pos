import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from '../../core/services/api.service';

@Injectable({ providedIn: 'root' })
export class BarcodeService {
  private api = inject(ApiService);

  lookupBarcode(barcode: string): Observable<any> {
    return this.api.get<any>(`/pos/lookup/${barcode}`).pipe(map(res => res.data));
  }

  searchProducts(query: string): Observable<any> {
    return this.api.get<any>('/pos/products/search', { q: query }).pipe(map(res => res.data));
  }
}
