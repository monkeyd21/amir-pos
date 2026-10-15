import { Injectable, signal } from '@angular/core';

/**
 * Whether the navigation drawer is open on a narrow screen. On a desktop the
 * sidebar is always shown and this stays false; below 768px the sidebar is a
 * drawer that the header's menu button opens and any navigation closes.
 */
@Injectable({ providedIn: 'root' })
export class NavDrawerService {
  readonly open = signal(false);

  toggle(): void {
    this.open.update((v) => !v);
  }

  close(): void {
    this.open.set(false);
  }
}
