import { promises as fs } from 'fs';
import path from 'path';
import { config } from '../config';

/**
 * Where uploaded pictures live.
 *
 * Today that is a directory on the box, served straight from disk by nginx at
 * MEDIA_PUBLIC_URL so image traffic never reaches Node. The plan is object
 * storage behind a CDN (docs/ecommerce/PLAN.md §5); moving there means a second
 * implementation of this interface, copying the files under the same keys, and
 * rewriting `ProductImage.url` from `storageKey`. Callers only ever see keys.
 *
 * Keys are content-unique (`products/<id>/<uuid>.<ext>`) and never reused, so
 * every URL can be cached forever.
 */
export interface MediaStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
  publicUrl(key: string): string;
}

const KEY = /^[a-z0-9]+(?:\/[a-z0-9-]+)*\.[a-z0-9]+$/;

/** Refuse anything that could step outside the media directory. */
export function assertSafeKey(key: string): void {
  if (!KEY.test(key) || key.includes('..')) {
    throw new Error(`Unsafe media key: ${key}`);
  }
}

export class LocalDiskStorage implements MediaStorage {
  constructor(
    private readonly root: string,
    private readonly baseUrl: string
  ) {}

  async put(key: string, body: Buffer): Promise<void> {
    assertSafeKey(key);
    const file = path.join(this.root, key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    // Write beside the target and rename, so nginx never serves half a file.
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, body, { mode: 0o644 });
    await fs.rename(tmp, file);
  }

  async remove(key: string): Promise<void> {
    assertSafeKey(key);
    try {
      await fs.unlink(path.join(this.root, key));
    } catch (err: any) {
      if (err?.code !== 'ENOENT') throw err;
    }
  }

  publicUrl(key: string): string {
    return `${this.baseUrl.replace(/\/+$/, '')}/${key}`;
  }
}

export const mediaStorage: MediaStorage = new LocalDiskStorage(config.media.dir, config.media.publicUrl);
