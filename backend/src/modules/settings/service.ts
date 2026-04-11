import prisma from '../../config/database';

/**
 * Generic key/value settings backed by the `settings` table.
 *
 * NOTE: Label templates previously lived here under the `labelTemplate` key.
 * They now live in the branch-scoped `label_templates` table, managed by the
 * printing module. See `backend/src/modules/printing/`.
 */

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (!row) return fallback;
  return row.value as unknown as T;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: value as any },
    update: { value: value as any },
  });
}
