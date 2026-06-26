import { Prisma } from '@prisma/client';
import prisma from '../config/database';

/**
 * Append-only audit trail for sensitive operations. Call inside the same
 * transaction as the change so the log and the change commit (or roll back)
 * together — pass the `tx` client. Outside a transaction, omit it and the
 * shared prisma client is used.
 *
 * Keep `action` namespaced (`entity.verb`) and put before/after values under
 * `data.original` / `data.updated` so the trail is queryable and diff-able.
 */
export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | number | null;
  userId?: number | null;
  branchId?: number | null;
  reason?: string | null;
  data?: unknown;
}

type Client = Prisma.TransactionClient | typeof prisma;

export async function recordAudit(client: Client, entry: AuditEntry): Promise<void> {
  await client.auditLog.create({
    data: {
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId != null ? String(entry.entityId) : null,
      userId: entry.userId ?? null,
      branchId: entry.branchId ?? null,
      reason: entry.reason ?? null,
      data: (entry.data ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
