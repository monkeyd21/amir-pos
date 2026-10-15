import {
  ChangeDetectionStrategy,
  Component,
  ContentChildren,
  Directive,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
  QueryList,
  TemplateRef,
  ViewChild,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { BOX_BY_ID, BoxId, LayoutBox, moveBox, resizeBox, sameLayout } from './dashboard-layout';

/** `<ng-template dashBox="profit">…</ng-template>`: one box's content. */
@Directive({ selector: 'ng-template[dashBox]', standalone: true })
export class DashBoxDirective {
  @Input('dashBox') id!: BoxId;
  constructor(public tpl: TemplateRef<unknown>) {}
}

/** Row unit and gap in px; heights in the layout are counted in rows. */
export const ROW_PX = 64;
export const GAP_PX = 16;

/**
 * Dashboard spec §1.3b: every box can be dragged to a new place (the ≡ handle)
 * and, on desktop, resized from its corner (the ◢ handle), snapping to the
 * 12-column grid and to whole rows. On mobile the grid is one column, so only
 * the order can change.
 *
 * Moves and resizes are previewed live on a working copy and handed to the
 * parent once the pointer is released, so a drag saves once, not 40 times.
 * Both handles are buttons and work from the keyboard too: arrows on ≡ move a
 * box, arrows on ◢ resize it.
 */
@Component({
  selector: 'app-dashboard-grid',
  standalone: true,
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      #grid
      class="dash-grid"
      [class.dash-grid--mobile]="mobile"
      [style.grid-auto-rows]="mobile ? 'auto' : rowPx + 'px'"
      [style.gap.px]="gapPx"
    >
      @for (b of shown(); track b.id) {
        <section
          class="dash-box group"
          [attr.data-box-id]="b.id"
          [attr.aria-label]="title(b.id)"
          [class.dash-box--dragging]="dragging() === b.id"
          [class.dash-box--resizing]="resizing() === b.id"
          [style.grid-column]="mobile ? 'auto' : 'span ' + b.w"
          [style.grid-row]="mobile ? 'auto' : 'span ' + b.h"
        >
          <ng-container [ngTemplateOutlet]="template(b.id)"></ng-container>
          <button
            type="button"
            class="dash-handle dash-handle--move"
            [attr.aria-label]="'Move ' + title(b.id) + '. Use the arrow keys to move it'"
            title="Drag to rearrange"
            (pointerdown)="startDrag($event, b.id)"
            (keydown)="moveKey($event, b.id)"
          >
            <span class="material-symbols-outlined text-[18px]">drag_indicator</span>
          </button>
          @if (!mobile) {
            <button
              type="button"
              class="dash-handle dash-handle--resize"
              [attr.aria-label]="'Resize ' + title(b.id) + '. Use the arrow keys to resize it'"
              title="Drag to resize"
              (pointerdown)="startResize($event, b)"
              (keydown)="resizeKey($event, b)"
            >
              <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
                <path d="M9 1 L1 9 M9 5 L5 9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
              </svg>
            </button>
          }
        </section>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .dash-grid {
        display: grid;
        grid-template-columns: repeat(12, minmax(0, 1fr));
        grid-auto-flow: row;
      }
      .dash-grid--mobile {
        grid-template-columns: minmax(0, 1fr);
      }
      .dash-box {
        position: relative;
        min-width: 0;
        min-height: 0;
        border-radius: 0.875rem;
        transition: box-shadow 150ms ease, opacity 150ms ease;
      }
      .dash-box--dragging {
        opacity: 0.55;
        box-shadow: 0 0 0 2px rgba(187, 195, 255, 0.55);
      }
      .dash-box--resizing {
        box-shadow: 0 0 0 2px rgba(187, 195, 255, 0.4);
      }
      .dash-handle {
        position: absolute;
        display: grid;
        place-items: center;
        border: 0;
        background: transparent;
        color: #8f8fa2;
        opacity: 0;
        cursor: grab;
        touch-action: none;
        border-radius: 6px;
        transition: opacity 120ms ease, color 120ms ease, background 120ms ease;
      }
      .dash-handle:focus-visible {
        opacity: 1;
        outline: 2px solid #bbc3ff;
        outline-offset: 1px;
      }
      .dash-box:hover .dash-handle,
      .dash-box--dragging .dash-handle,
      .dash-box--resizing .dash-handle {
        opacity: 0.85;
      }
      .dash-handle:hover {
        color: #dae2fd;
        background: rgba(255, 255, 255, 0.06);
      }
      .dash-handle--move {
        top: 6px;
        right: 6px;
        width: 26px;
        height: 26px;
      }
      .dash-handle--resize {
        right: 2px;
        bottom: 2px;
        width: 18px;
        height: 18px;
        cursor: nwse-resize;
      }
      /* Touch screens have no hover: keep the move handle findable. */
      @media (hover: none) {
        .dash-handle--move {
          opacity: 0.6;
        }
      }
    `,
  ],
})
export class DashboardGridComponent implements OnChanges, OnDestroy {
  /** The full saved order, hidden boxes included (they keep their slot). */
  @Input({ required: true }) layout: LayoutBox[] = [];
  /** Boxes to render right now: role-visible and, if conditional, present. */
  @Input({ required: true }) visible: ReadonlySet<BoxId> = new Set();
  @Input() mobile = false;
  @Output() layoutChange = new EventEmitter<LayoutBox[]>();

  @ContentChildren(DashBoxDirective) boxes!: QueryList<DashBoxDirective>;
  @ViewChild('grid', { static: true }) gridRef!: ElementRef<HTMLElement>;

  readonly rowPx = ROW_PX;
  readonly gapPx = GAP_PX;
  readonly working = signal<LayoutBox[]>([]);
  readonly dragging = signal<BoxId | null>(null);
  readonly resizing = signal<BoxId | null>(null);

  private cleanup: (() => void) | null = null;

  constructor(private zone: NgZone) {}

  ngOnChanges(): void {
    if (!this.dragging() && !this.resizing()) this.working.set(this.layout);
  }

  ngOnDestroy(): void {
    this.cleanup?.();
  }

  shown(): LayoutBox[] {
    return this.working().filter((b) => this.visible.has(b.id));
  }

  title(id: BoxId): string {
    return BOX_BY_ID.get(id)?.title ?? id;
  }

  template(id: BoxId): TemplateRef<unknown> | null {
    return this.boxes?.find((b) => b.id === id)?.tpl ?? null;
  }

  // ─── Drag to rearrange ───

  startDrag(ev: PointerEvent, id: BoxId): void {
    if (ev.button !== 0) return;
    ev.preventDefault();
    this.dragging.set(id);
    const scroller = this.gridRef.nativeElement.closest('main') as HTMLElement | null;
    let lastKey = '';
    let pointerY = ev.clientY;
    let raf = 0;

    // Scroll the page while the pointer rests near its top or bottom edge.
    const autoScroll = () => {
      if (scroller) {
        const r = scroller.getBoundingClientRect();
        const edge = 70;
        if (pointerY < r.top + edge) scroller.scrollTop -= Math.ceil((r.top + edge - pointerY) / 6);
        else if (pointerY > r.bottom - edge) scroller.scrollTop += Math.ceil((pointerY - (r.bottom - edge)) / 6);
      }
      raf = requestAnimationFrame(autoScroll);
    };

    const onMove = (e: PointerEvent) => {
      pointerY = e.clientY;
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-box-id]');
      const target = el?.dataset['boxId'] as BoxId | undefined;
      if (!el || !target || target === id) return;
      const r = el.getBoundingClientRect();
      const after = this.mobile ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
      const key = `${target}:${after}`;
      if (key === lastKey) return;
      lastKey = key;
      this.zone.run(() => this.working.set(moveBox(this.working(), id, target, after)));
    };

    const onUp = () => {
      this.cleanup?.();
      this.zone.run(() => {
        this.dragging.set(null);
        this.commit();
      });
    };

    this.zone.runOutsideAngular(() => {
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      raf = requestAnimationFrame(autoScroll);
    });
    this.cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      cancelAnimationFrame(raf);
      this.cleanup = null;
    };
  }

  moveKey(ev: KeyboardEvent, id: BoxId): void {
    const delta = ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : 0;
    if (!delta) return;
    ev.preventDefault();
    // Hop over the neighbouring VISIBLE box, so every key press visibly moves
    // something even when a hidden box (it keeps its slot) sits in between.
    const visibleIds = this.shown().map((b) => b.id);
    const target = visibleIds[visibleIds.indexOf(id) + delta];
    if (!target) return;
    const next = moveBox(this.working(), id, target, delta > 0);
    this.working.set(next);
    this.commit();
    // Keep focus on the handle of the box that just moved.
    setTimeout(() =>
      this.gridRef.nativeElement.querySelector<HTMLElement>(`[data-box-id="${id}"] .dash-handle--move`)?.focus()
    );
  }

  // ─── Resize from the corner ───

  startResize(ev: PointerEvent, box: LayoutBox): void {
    if (ev.button !== 0) return;
    ev.preventDefault();
    this.resizing.set(box.id);
    const grid = this.gridRef.nativeElement;
    const colStep = (grid.clientWidth + GAP_PX) / 12;
    const rowStep = ROW_PX + GAP_PX;
    const x0 = ev.clientX;
    const y0 = ev.clientY;

    const onMove = (e: PointerEvent) => {
      const w = box.w + Math.round((e.clientX - x0) / colStep);
      const h = box.h + Math.round((e.clientY - y0) / rowStep);
      const next = resizeBox(this.working(), box.id, w, h);
      if (!sameLayout(next, this.working())) this.zone.run(() => this.working.set(next));
    };
    const onUp = () => {
      this.cleanup?.();
      this.zone.run(() => {
        this.resizing.set(null);
        this.commit();
      });
    };
    this.zone.runOutsideAngular(() => {
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
    this.cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      this.cleanup = null;
    };
  }

  resizeKey(ev: KeyboardEvent, box: LayoutBox): void {
    const dw = ev.key === 'ArrowLeft' ? -1 : ev.key === 'ArrowRight' ? 1 : 0;
    const dh = ev.key === 'ArrowUp' ? -1 : ev.key === 'ArrowDown' ? 1 : 0;
    if (!dw && !dh) return;
    ev.preventDefault();
    const current = this.working().find((b) => b.id === box.id)!;
    this.working.set(resizeBox(this.working(), box.id, current.w + dw, current.h + dh));
    this.commit();
  }

  private commit(): void {
    if (!sameLayout(this.working(), this.layout)) this.layoutChange.emit(this.working());
  }
}
