import { isNativeApp, resolveApiUrl } from './api-url';

/**
 * bug4 — a production build serves two very different hosts.
 *
 * On the web the Angular bundle is served BY the backend out of
 * backend/public, so a relative '/api/v1' is correct and keeps the app working
 * on whatever domain it sits behind.
 *
 * Inside a Capacitor WebView there is no such origin — the page is loaded from
 * the device, so a relative URL resolves against the phone and reaches nothing.
 * A release APK therefore falls back to the absolute production host. The old
 * unconditional '/api/v1' is why a production-configuration APK could never
 * have talked to the backend.
 */
export const environment = {
  production: true,
  get apiUrl(): string {
    return isNativeApp() ? resolveApiUrl() : '/api/v1';
  },
};
