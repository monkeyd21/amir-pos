import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/config';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Nothing personal or transactional should ever be indexed.
      disallow: ['/cart', '/checkout', '/account', '/order', '/api'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
