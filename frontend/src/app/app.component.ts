import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter, interval } from 'rxjs';
import { ToastComponent } from './shared/toast/toast.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ToastComponent],
  template: `
    <router-outlet></router-outlet>
    <app-toast></app-toast>
  `,
  styles: [`:host { display: block; height: 100%; }`],
})
export class AppComponent {
  private swUpdate = inject(SwUpdate);

  constructor() {
    // Service worker update handling. Without this the POS — whose tabs stay
    // open all day — keeps serving the OLD cached bundle after a deploy until
    // every tab is closed, which reads as "flaky after an update" (a plain
    // refresh doesn't help because the SW intercepts it).
    if (this.swUpdate.isEnabled) {
      // Poll for a newer deploy so long-lived tabs notice it without a full close.
      interval(60_000).subscribe(() => this.swUpdate.checkForUpdate().catch(() => {}));

      // New version finished downloading in the background — offer to apply it.
      this.swUpdate.versionUpdates
        .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
        .subscribe(() => {
          if (confirm('A new version of the app is available. Reload now to update?')) {
            this.swUpdate.activateUpdate().then(() => document.location.reload());
          }
        });

      // Cache is in an unrecoverable state (a needed file went missing) — a
      // hard reload is the only way out.
      this.swUpdate.unrecoverable.subscribe(() => document.location.reload());
    }
  }
}
