import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, tap, map } from 'rxjs';
import { ApiService } from './api.service';

export interface Branch {
  id: string;
  name: string;
  code: string;
  address?: string;
  phone?: string;
  isActive: boolean;
}

@Injectable({ providedIn: 'root' })
export class BranchService {
  private currentBranchSubject = new BehaviorSubject<Branch | null>(this.getStoredBranch());
  currentBranch$ = this.currentBranchSubject.asObservable();

  private branchesSubject = new BehaviorSubject<Branch[]>([]);
  branches$ = this.branchesSubject.asObservable();

  constructor(private api: ApiService) {}

  getBranches(): Observable<Branch[]> {
    return this.api.get<any>('/branches').pipe(
      map((res) => res.data || res || []),
      tap((branches) => this.branchesSubject.next(branches))
    );
  }

  getCurrentBranch(): Branch | null {
    return this.currentBranchSubject.value;
  }

  switchBranch(branch: Branch): void {
    const previous = this.currentBranchSubject.value;
    localStorage.setItem('currentBranch', JSON.stringify(branch));
    this.currentBranchSubject.next(branch);

    // Reload the page if switching to a different branch so all data refreshes
    if (previous && previous.id !== branch.id) {
      window.location.reload();
    }
  }

  private getStoredBranch(): Branch | null {
    const stored = localStorage.getItem('currentBranch');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        return null;
      }
    }
    return null;
  }
}
