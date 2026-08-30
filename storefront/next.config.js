/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
