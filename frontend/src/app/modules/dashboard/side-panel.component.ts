import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, EventEmitter, HostListener, Input, Output, ViewChild } from '@angular/core';

/**
 * The dashboard's side panel frame (§1.6): slides in from the right, full
 * width on a phone, closes on Esc or a tap outside. Fixed to the viewport at
 * the page root, so no stacking context in the layout can clip it.
 */
@Component({
  selector: 'dash-side-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true" [attr.aria-label]="title">
      <div class="absolute inset-0 bg-black/50 backdrop-blur-[2px]" (click)="closed.emit()"></div>
      <aside class="relative flex h-full w-full flex-col bg-surface-container-low shadow-2xl ring-1 ring-outline-variant/20 sm:max-w-[30rem]">
        <header class="flex items-center gap-3 border-b border-outline-variant/15 px-5 py-4">
          <h2 class="min-w-0 flex-1 truncate font-headline text-lg font-bold text-on-surface">{{ title }}</h2>
          <button
            #closeBtn
            type="button"
            class="grid h-9 w-9 place-items-center rounded-lg text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
            aria-label="Close"
            (click)="closed.emit()"
          >
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </header>
        <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-[14px] text-on-surface">
          <ng-content></ng-content>
        </div>
      </aside>
    </div>
  `,
})
export class SidePanelComponent implements AfterViewInit {
  @Input({ required: true }) title!: string;
  @Output() closed = new EventEmitter<void>();
  @ViewChild('closeBtn') closeBtn?: ElementRef<HTMLButtonElement>;

  ngAfterViewInit(): void {
    this.closeBtn?.nativeElement.focus();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closed.emit();
  }
}
