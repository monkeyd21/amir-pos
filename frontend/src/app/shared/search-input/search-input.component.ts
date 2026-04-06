import { Component, Output, EventEmitter, OnInit, OnDestroy, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription, debounceTime, distinctUntilChanged } from 'rxjs';

@Component({
  selector: 'app-search-input',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './search-input.component.html',
})
export class SearchInputComponent implements OnInit, OnDestroy {
  @Input() placeholder = 'Search...';
  @Input() value = '';
  @Output() searchChange = new EventEmitter<string>();

  private searchSubject = new Subject<string>();
  private sub!: Subscription;

  ngOnInit(): void {
    this.sub = this.searchSubject
      .pipe(debounceTime(300), distinctUntilChanged())
      .subscribe(term => this.searchChange.emit(term));
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.value = value;
    this.searchSubject.next(value);
  }

  clear(): void {
    this.value = '';
    this.searchSubject.next('');
  }
}
