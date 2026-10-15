import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RETURN_REASONS } from '@clothing-erp/shared';

/**
 * Dashboard §5.2 — the return/exchange reason as a set of large tap targets.
 * A phone keyboard invited free text ("tite", "colour not ok"), which the
 * dashboard cannot count. The list is the shared one, so the counter, the
 * server and the reports agree on every code.
 */
@Component({
  selector: 'app-reason-picker',
  standalone: true,
  template: `
    <div class="reason-grid" role="radiogroup" [attr.aria-label]="label">
      @for (r of reasons; track r.code) {
        <button
          type="button"
          role="radio"
          class="reason-chip"
          [class.reason-chip--on]="value === r.code"
          [attr.aria-checked]="value === r.code"
          [attr.data-testid]="'reason-' + r.code"
          (click)="valueChange.emit(r.code)"
        >
          {{ r.label }}
        </button>
      }
    </div>
  `,
  styles: [
    `
      .reason-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }
      .reason-chip {
        min-height: 48px;
        padding: 10px 12px;
        border-radius: 12px;
        border: 1px solid var(--mp-border);
        background: var(--mp-surface);
        color: var(--mp-on-bg);
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        line-height: 1.25;
        text-align: left;
        cursor: pointer;
        transition: background 120ms ease, border-color 120ms ease;
      }
      .reason-chip--on {
        border-color: var(--mp-primary);
        background: var(--mp-primary-soft);
        color: var(--mp-primary);
      }
    `,
  ],
})
export class ReasonPickerComponent {
  @Input() value = '';
  @Input() label = 'Reason';
  @Output() valueChange = new EventEmitter<string>();

  readonly reasons = RETURN_REASONS;
}
