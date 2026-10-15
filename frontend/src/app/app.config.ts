import { ApplicationConfig, isDevMode } from '@angular/core';
import { DATE_PIPE_DEFAULT_OPTIONS } from '@angular/common';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideServiceWorker } from '@angular/service-worker';
import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { errorInterceptor } from './core/interceptors/error.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, withComponentInputBinding()),
    // authInterceptor first so its catchError sees 401s before errorInterceptor
    // (interceptors run LIFO on the response path) — that lets it transparently
    // refresh the access token instead of bouncing the user to /login.
    provideHttpClient(withInterceptors([errorInterceptor, authInterceptor])),
    provideAnimationsAsync(),
    // Dashboard spec checklist #16: dates read DD-MM-YYYY, in India time,
    // wherever a template does not name its own format.
    { provide: DATE_PIPE_DEFAULT_OPTIONS, useValue: { dateFormat: 'dd-MM-yyyy', timezone: '+0530' } },
    // App-shell service worker so the POS survives a COLD reload offline (loads
    // the cached SPA without the network). Production builds only; data still
    // flows through OfflineService. Registers once the app is stable.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
