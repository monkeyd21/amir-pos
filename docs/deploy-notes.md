# Deploy Notes — Production (Contabo VPS)

> **Secrets are NOT in this file.** They live in `deploy-secrets.local` at the
> repo root (gitignored, chmod 600). Copy `deploy-secrets.local.example` and fill
> in the password. Never commit it.

## Deploying

```bash
./deploy/push.sh                # build HEAD locally, ship artifacts, restart, smoke check
./deploy/push.sh --allow-dirty  # deploy the working tree as-is
./deploy/push.sh --skip-build   # reuse the last local build
```

**Everything is built on your machine.** The box receives only compiled output —
`backend/dist`, `backend/public`, and `schema.prisma` when it changed. It has no
source, no Dockerfile, no deploy scripts and no credentials, so nothing on the
box can deploy the box.

The script refuses to run on a dirty tree unless you pass `--allow-dirty`, keeps
the previous release in `backend/dist.prev` / `backend/public.prev`, writes the
deployed SHA to `/opt/amir-pos/.release-commit`, and fails loudly if the
post-restart smoke check is not 200.

**Rollback:**
```bash
cd /opt/amir-pos && rm -rf backend/dist backend/public \
  && mv backend/dist.prev backend/dist && mv backend/public.prev backend/public \
  && systemctl restart amir-pos
```

## Schema changes

`prisma migrate deploy` is the normal path again. The production migration
history was repaired on 2026-09-04 and is now clean: 45 entries in
`_prisma_migrations` against the 45 migration directories in the repo, with 0
unfinished, 0 rolled back, 0 checksum mismatches, and 0 entries without a
matching directory.

Order of work for a schema change:

1. Add the migration to `backend/prisma/migrations/` as usual.
2. Apply it to prod with `prisma migrate deploy` against the `amir_pos`
   database. `push.sh` still does not issue DDL of its own: if `schema.prisma`
   differs from the box it warns, ships the new schema and regenerates the
   Prisma client, nothing more.
3. Then run `./deploy/push.sh`.

Take a dump before any schema change regardless.

### Why some rows say "baselined 2026-09-04"

Thirteen entries in `_prisma_migrations` carry `baselined 2026-09-04` in their
`logs` column. They are not a defect, they are the record of a repair.

Until 2026-09-04 the history table had two bookkeeping defects, and nothing
wrong with the schema itself:

- A permanently unfinished row for `20260508210000_add_held_transactions`
  (`finished_at IS NULL`, `applied_steps_count = 0`). The `held_transactions`
  table it creates did exist in production, so the migration had in fact been
  applied and only the failure record was stale. That row is what made
  `migrate deploy` abort on sight.
- Thirteen migrations applied to production by hand between 2026-07-20 and
  2026-08-30 that were never recorded, leaving 32 ledger entries against 45
  migration directories in the repo.

Before repairing, the live schema was verified against the repo. The full
expected DDL was generated with
`prisma migrate diff --from-empty --to-schema-datamodel`, and all 680 expected
columns were confirmed present in production with none missing. The 32
already-recorded entries were confirmed to checksum-match their files exactly.
The only object in production not described by the schema is
`historical_bills_datefix_bak_20260803`, a leftover backup table from a manual
date fix in August.

The repair itself ran as one transaction: delete the unfinished row, insert 13
rows recording the hand-applied migrations with their real sha256 checksums.
Both services stayed up throughout, with zero restarts. Pre-change backups are
on the box at `/root/db-backups/`: `amir_pos_20260904_175740.dump` (the full
database) and `prisma_migrations_20260904_175740.csv` (the history table as it
was).

### `deploy/sql/`

`deploy/sql/20260828_payroll_payables_prod.sql` and
`deploy/sql/20260830_shop_storefront_prod.sql` are the historical record of how
the last two schema changes actually reached production, back when
`migrate deploy` could not run. They are kept for that reason and as a reference
for the reviewed-idempotent-SQL house style, which is still the right shape for
any one-off data repair. They are not the routine path for a schema change any
more.

## Box
- Contabo VPS, Ubuntu 24.04, IP **147.93.169.149**, hostname `vmi3382646`.
- node v20, npm 10, 6 cores, 11 GB RAM.
- App lives at **`/opt/amir-pos`** (owned by `amir`). Not a git checkout.
- systemd unit **`amir-pos.service`** — `User=amir`,
  `ExecStart=/usr/bin/node dist/server.js`, `WorkingDirectory=/opt/amir-pos/backend`.
  Serves the Angular build from `backend/public` when `NODE_ENV=production`.
- Postgres local: db `amir_pos`, role `amir`.
- `.env` at `/opt/amir-pos/backend/.env` (chmod 600, never shipped — survives deploys).
- `JWT_EXPIRES_IN` is `8h` in prod (was 15m — caused frequent logouts).

## Domains
- `erp.sabihasethnic.com` → nginx → Node on `127.0.0.1:3000`. HTTPS via Let's Encrypt (auto-renew).
- `sabihasethnic.com` + `www` → static "coming soon" page.

## Access
- SSH as **root**, **password auth only** — no key is installed on the box.
- `sshpass` is not available locally, so `deploy/remote.py` (paramiko) does the
  work: `remote.py run "<cmd>"` and `remote.py put <local> <remote>`. It reads
  `deploy-secrets.local` and never prints the password. `deploy/push.sh`
  bootstraps its own venv at `deploy/.venv` on first run.

```bash
deploy/.venv/bin/python deploy/remote.py run 'systemctl status amir-pos --no-pager'
```

## What is deliberately NOT on the box
Stripped 2026-08-29 (105 MB → 16 MB), archived first to
`/root/amir-pos-stripped-20260829.tgz`, and all of it recoverable from git:
source trees (`backend/src`, `frontend/src`, `shared/src`, `e2e`), deploy tooling
(`Dockerfile`, `docker-compose.yml`, `.dockerignore`, `railway.toml`, `.github`,
`deploy/`, `scripts/`), and ~73 MB of abandoned `dist.old_*` / `public.old_*` /
`*.bak-*.tgz` backups. Docker was never installed, so the old GitHub Actions
deploy job could not have worked regardless.

Kept: `backend/scripts/` (`import-legacy.js`, `import-stock-bills.js` — real
operational tools that run against the prod DB).
