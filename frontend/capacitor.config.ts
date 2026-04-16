import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.clothingerp.pos',
  appName: 'Atelier POS',
  webDir: 'dist/frontend/browser',
  server: {
    // For live reload during dev — points the native app at your laptop's Angular dev server
    // Set via: CAP_SERVER_URL=http://192.168.148.129:4200 npx cap sync
    url: process.env['CAP_SERVER_URL'] || undefined,
    cleartext: true, // allow HTTP (dev only)
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: true, // allow cleartext backend in dev
  },
  plugins: {
    BarcodeScanner: {
      // ML Kit will download the scanner module on first use
    },
  },
};

export default config;
