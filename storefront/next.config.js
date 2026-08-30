/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle: the box gets a traced node_modules and can
  // run `node server.js` with no npm install. Matches how the ERP is deployed —
  // everything is built here, the box only ever receives compiled output.
  output: 'standalone',
  // The shared workspace ships TypeScript source, not a browser bundle.
  transpilePackages: ['@clothing-erp/shared'],
  images: {
    // Product imagery is served from object storage behind a CDN, never from
    // the application box — see docs/ecommerce/PLAN.md §5.
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
  poweredByHeader: false,
};

module.exports = nextConfig;
