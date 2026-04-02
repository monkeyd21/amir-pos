import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, tap } from 'rxjs';
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
    return this.api.get<Branch[]>('/branches').pipe(
      tap((branches) => this.branchesSubject.next(branches))
    );
  }

  getCurrentBranch(): Branch | null {
    return this.currentBranchSubject.value;
  }

  switchBranch(branch: Branch): void {
    localStorage.setItem('currentBranch', JSON.stringify(branch));
    this.currentBranchSubject.next(branch);
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
