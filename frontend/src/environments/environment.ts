import { Capacitor } from '@capacitor/core';

/**
 * API URL resolution:
 * - Native app (Capacitor): must use the laptop's LAN IP. `window.location.hostname`
 *   is `localhost` inside the Capacitor WebView, which points at the phone itself.
 *   Override via the MOBILE_API_HOST constant below.
 * - Desktop dev at http://localhost:4200: use localhost:3000.
 * - LAN test (opening http://192.168.x.x:4200 from another device in Chrome): use
 *   the same hostname the page was served from.
 */
// Native mobile builds hit the Railway production backend directly.
// Railway service: splendid-light/skillful-embrace — deployed via GH Actions on push to main.
const MOBILE_API_URL = 'https://amir-pos.up.railway.app/api/v1';

function resolveApiUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:3000/api/v1';

  // Native app (Capacitor Android/iOS) — use the public Pinggy tunnel.
  try {
    if (Capacitor.isNativePlatform()) {
      return MOBILE_API_URL;
    }
  } catch {
    // Capacitor may not be loaded on desktop — ignore.
  }

  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    return 'http://localhost:3000/api/v1';
  }
  return `http://${host}:3000/api/v1`;
}

export const environment = {
  production: false,
  apiUrl: resolveApiUrl(),
};
