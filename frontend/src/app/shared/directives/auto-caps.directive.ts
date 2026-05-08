import { Directive, ElementRef, HostListener, Optional } from '@angular/core';
import { NgControl } from '@angular/forms';

/**
 * Force-uppercases manual text entry as the user types — Indian retail
 * bills and labels are conventionally all-caps, and we don't want one
 * customer record stored as "Anjali" and another as "ANJALI".
 *
 * Apply to: product name, customer name, vendor name, brand/category
 * name, addresses. Do NOT apply to email, password, SKU (already
 * generated upper), or numeric fields — those have their own rules.
 *
 * The directive keeps the DOM input value, the form-control value, and
 * the caret position in sync. Pasting and IME composition both go
 * through `input` events so this covers them too.
 */
@Directive({
  selector: '[appAutoCaps]',
  standalone: true,
})
export class AutoCapsDirective {
  constructor(
    private host: ElementRef<HTMLInputElement | HTMLTextAreaElement>,
    @Optional() private ngControl: NgControl
  ) {}

  @HostListener('input')
  onInput(): void {
    const el = this.host.nativeElement;
    const original = el.value;
    const upper = original.toUpperCase();
    if (upper === original) return;

    // Preserve caret because replacing .value would otherwise jump it
    // to the end on some browsers — frustrating mid-edit for cashiers.
    const start = el.selectionStart;
    const end = el.selectionEnd;
    el.value = upper;
    if (start !== null && end !== null) {
      try {
        el.setSelectionRange(start, end);
      } catch {
        // some input types (number, etc.) reject setSelectionRange — ignore
      }
    }

    // Push the upper value into the bound form control / ngModel so the
    // component sees the normalized string, not the lower-case input.
    if (this.ngControl?.control) {
      this.ngControl.control.setValue(upper, { emitEvent: false });
    }
  }
}
