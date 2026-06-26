import { Directive, HostListener } from '@angular/core';

/**
 * Stops a numeric input from changing its value via the Up/Down arrow keys or
 * the mouse wheel. On the POS, the cashier often tabs into the discount or
 * redeem-points field and an accidental arrow press / scroll would silently
 * bump a discount or points value — a real money bug. This keeps the value
 * editable only by typing.
 *
 * Apply to: manual discount, special discount, redeem-points inputs.
 */
@Directive({
  selector: '[appNoSpin]',
  standalone: true,
})
export class NoSpinDirective {
  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
    }
  }

  // A focused number input also responds to wheel scroll — block that too.
  @HostListener('wheel', ['$event'])
  onWheel(event: WheelEvent): void {
    const target = event.target as HTMLElement | null;
    if (target && typeof (target as any).blur === 'function') {
      // Only intercept when the input is the focused element.
      if (document.activeElement === target) {
        event.preventDefault();
      }
    }
  }
}
