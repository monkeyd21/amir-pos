import { AfterViewInit, Directive, ElementRef, NgZone, OnDestroy, Renderer2 } from '@angular/core';

/**
 * Adds drag-to-resize handles to every `<th>` in a table's header. Drop it on the
 * `<table>` element: `<table appResizableCols>`. Each header gets a thin grip on
 * its right edge; dragging pins that column's width (width/min/max), so the table
 * scrolls horizontally rather than reflowing. Widths live on the DOM, so they
 * reset when the table is re-rendered (e.g. a new report run) — intentional and
 * dependency-free.
 */
@Directive({
  selector: 'table[appResizableCols]',
  standalone: true,
})
export class ResizableColumnsDirective implements AfterViewInit, OnDestroy {
  private cleanups: Array<() => void> = [];
  private moveUnlisten: (() => void) | null = null;
  private upUnlisten: (() => void) | null = null;
  private startX = 0;
  private startW = 0;
  private target: HTMLElement | null = null;

  constructor(
    private el: ElementRef<HTMLTableElement>,
    private r: Renderer2,
    private zone: NgZone
  ) {}

  ngAfterViewInit(): void {
    // Defer so conditional (@if) header cells are in the DOM first.
    setTimeout(() => this.attachHandles());
  }

  private attachHandles(): void {
    const ths = Array.from(this.el.nativeElement.querySelectorAll('thead th')) as HTMLElement[];
    for (const th of ths) {
      if (getComputedStyle(th).position === 'static') this.r.setStyle(th, 'position', 'relative');

      const handle = this.r.createElement('span') as HTMLElement;
      this.r.setStyle(handle, 'position', 'absolute');
      this.r.setStyle(handle, 'top', '0');
      this.r.setStyle(handle, 'right', '0');
      this.r.setStyle(handle, 'height', '100%');
      this.r.setStyle(handle, 'width', '7px');
      this.r.setStyle(handle, 'cursor', 'col-resize');
      this.r.setStyle(handle, 'userSelect', 'none');
      this.r.setStyle(handle, 'touchAction', 'none');
      this.r.appendChild(th, handle);

      // Run outside Angular — pure DOM mutation, no change detection needed.
      const down = this.r.listen(handle, 'mousedown', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        this.startResize(th, e.clientX);
      });
      this.cleanups.push(down);
    }
  }

  private startResize(th: HTMLElement, clientX: number): void {
    this.target = th;
    this.startX = clientX;
    this.startW = th.offsetWidth;
    this.r.setStyle(document.body, 'userSelect', 'none');
    this.r.setStyle(document.body, 'cursor', 'col-resize');
    this.zone.runOutsideAngular(() => {
      this.moveUnlisten = this.r.listen('document', 'mousemove', (e: MouseEvent) => this.onMove(e));
      this.upUnlisten = this.r.listen('document', 'mouseup', () => this.endResize());
    });
  }

  private onMove(e: MouseEvent): void {
    if (!this.target) return;
    const w = Math.max(48, this.startW + (e.clientX - this.startX));
    this.r.setStyle(this.target, 'width', `${w}px`);
    this.r.setStyle(this.target, 'minWidth', `${w}px`);
    this.r.setStyle(this.target, 'maxWidth', `${w}px`);
  }

  private endResize(): void {
    this.moveUnlisten?.();
    this.upUnlisten?.();
    this.moveUnlisten = this.upUnlisten = null;
    this.target = null;
    this.r.removeStyle(document.body, 'userSelect');
    this.r.removeStyle(document.body, 'cursor');
  }

  ngOnDestroy(): void {
    this.endResize();
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
  }
}
