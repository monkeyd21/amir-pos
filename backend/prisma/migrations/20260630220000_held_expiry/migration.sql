-- §4.4 — holds auto-expire (default 24h).
ALTER TABLE "held_transactions" ADD COLUMN "expiresAt" TIMESTAMP(3);
