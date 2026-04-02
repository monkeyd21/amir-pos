import { Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';

@Component({
  selector: 'app-search-input',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule],
  template: `
    <div class="relative">
      <mat-icon class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xl">search</mat-icon>
      <input
        type="text"
        [placeholder]="placeholder"
        [(ngModel)]="searchValue"
        (ngModelChange)="onInput($event)"
        class="w-full pl-10 pr-10 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all" />
      <button *ngIf="searchValue"
              (click)="clear()"
              class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
        <mat-icon class="text-lg">close</mat-icon>
      </button>
    </div>
  `,
})
export class SearchInputComponent implements OnInit, OnDestroy {
  @Input() placeholder = 'Search...';
  @Input() debounce = 300;
  @Output() search = new EventEmitter<string>();

  searchValue = '';
  private searchSubject = new Subject<string>();
  private destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.searchSubject.pipe(
      debounceTime(this.debounce),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe((value) => {
      this.search.emit(value);
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onInput(value: string): void {
    this.searchSubject.next(value);
  }

  clear(): void {
    this.searchValue = '';
    this.searchSubject.next('');
  }
}
