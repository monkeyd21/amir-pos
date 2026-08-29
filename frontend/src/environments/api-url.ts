import { Capacitor } from '@capacitor/core';

/**
 * bug4 — API host resolution, shared by both environment files.
 *
 * It lives in its own module rather than in environment.ts because the
 * production build REPLACES environment.ts with environment.prod.ts
 * (angular.json → fileReplacements). A prod file importing './environment'
 * would therefore import itself. Keeping the resolver separate is what makes it
 * safe for both to use.
 *
 * The native URL used to point at `https://amir-pos.up.railway.app`, a Railway
 * deployment that no longer exists (the app runs on the Contabo VPS behind
 * erp.sabihasethnic.com; the Railway/GitHub-Actions path was never live). An
 * APK built against that could not reach a backend at all. An earlier note
 * pointed it at a Pinggy tunnel instead, which only worked while someone kept
 * that tunnel open on a laptop. The real domain has a Let's Encrypt certificate
 * and is always up, so it is what ships.
 */
export const MOBILE_API_URL = 'https://erp.sabihasethnic.com/api/v1';

/** True inside a Capacitor WebView, where there is no useful page origin. */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    // Capacitor may not be loaded on desktop — ignore.
    return false;
  }
}

/**
 * - Native app (Capacitor): `window.location.hostname` is `localhost` inside the
 *   WebView, which points at the phone itself, so the URL must be absolute.
 * - Desktop dev at http://localhost:4200: use localhost:3000.
 * - LAN test (opening http://192.168.x.x:4200 from another device): use the same
 *   hostname the page was served from.
 */
export function resolveApiUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:3000/api/v1';
  if (isNativeApp()) return MOBILE_API_URL;

  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    return 'http://localhost:3000/api/v1';
  }
  return `http://${host}:3000/api/v1`;
}
