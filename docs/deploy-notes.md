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

## Schema changes — read this before shipping one

`prisma migrate deploy` **does not work on this box and must not be run.** The
migration history diverged long ago: 33 rows in `_prisma_migrations`, 41
migrations that were on the box, 45 in the repo, plus a permanently failed
`20260508210000_add_held_transactions` row. `migrate deploy` aborts on the first
already-existing table (`P3018`/`42P07`) and leaves another failed row behind,
which then blocks every future attempt.

Schema changes are applied **by hand**, as idempotent SQL under `deploy/sql/`
(see `20260828_payroll_payables_prod.sql` for the house style). Order of work:

1. Write and apply the SQL to prod yourself.
2. Then run `./deploy/push.sh`. If `schema.prisma` differs from the box it warns,
   ships the new schema and regenerates the Prisma client — but it never issues
   DDL of its own.

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
