import type { MetadataRoute } from 'next';
import { listProducts, getFacets } from '@/lib/api';
import { SITE_URL } from '@/lib/config';

/** Products are the pages that have to rank, so they carry the highest priority. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, facets] = await Promise.all([
    listProducts({ limit: '200' }),
    getFacets(),
  ]);

  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: now, priority: 1 },
    { url: `${SITE_URL}/c/all`, lastModified: now, priority: 0.8 },
    { url: `${SITE_URL}/size-guide`, lastModified: now, priority: 0.7 },
  ];

  const categoryPages: MetadataRoute.Sitemap = facets.success
    ? facets.data.categories.map((c: any) => ({
        url: `${SITE_URL}/c/${c.slug}`,
        lastModified: now,
        priority: 0.7,
      }))
    : [];

  const productPages: MetadataRoute.Sitemap = products.success
    ? products.data.map((p: any) => ({
        url: `${SITE_URL}/p/${p.slug}`,
        lastModified: now,
        priority: 0.9,
      }))
    : [];

  return [...staticPages, ...categoryPages, ...productPages];
}
