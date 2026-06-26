# Deploy Notes — Production (Contabo VPS)

> **Secrets are NOT in this file.** The server root password and DB password are
> intentionally redacted. Keep them in a password manager / local notes, not git.

## Box
- Contabo VPS, Ubuntu 24.04, IP **147.93.169.149**, hostname `vmi3382646`.
- node v20, npm 10.
- Repo lives at **`/opt/amir-pos`** (owned by system user `amir`). It is **NOT a
  git checkout** (no `.git`) — releases are pushed as a tarball.
- Backend runs via systemd unit **`amir-pos.service`** (`User=amir`,
  `ExecStart=/usr/bin/node dist/server.js`, WorkingDirectory `/opt/amir-pos/backend`).
  It serves the Angular build from `backend/public` when `NODE_ENV=production`.
- Postgres local: db `amir_pos`, role `amir`.
- `.env` is at `/opt/amir-pos/backend/.env` (chmod 600, **not** in the tarball — survives redeploys).

## Domains
- `erp.sabihasethnic.com` → nginx reverse proxy → Node backend on `127.0.0.1:3000`. HTTPS via Let's Encrypt (auto-renew).
- `sabihasethnic.com` + `www` → static "coming soon" page.

## Access
- SSH as **root**, **password auth only** (no key installed). Password is **not in
  this repo** — get it from local notes.
- `sshpass` is not installed locally; a small **paramiko** helper does the work
  (`run` = command via stdin, `put` = SFTP). Recreate it locally as needed.

## Redeploy (tarball flow)
From the repo on your laptop, on the commit you want to ship:

```bash
git archive --format=tar.gz -o /tmp/amir-pos.tar.gz HEAD
# SFTP the tarball to the box: /tmp/amir-pos.tar.gz
```

Then on the box (as root):

```bash
cd /opt/amir-pos
tar -xzf /tmp/amir-pos.tar.gz -C /opt/amir-pos     # .env/node_modules survive (gitignored)
npm ci                                              # only if package-lock changed
( cd backend && npx prisma generate && npx prisma migrate deploy )   # only if schema/migrations changed
npm run build --workspace=backend                   # tsc -> backend/dist
npm run build --workspace=frontend                  # production -> dist (incl. ngsw service worker)
rm -rf backend/public && mkdir -p backend/public
cp -r frontend/dist/frontend/browser/. backend/public/
chown -R amir:amir /opt/amir-pos                    # restore ownership after building as root
systemctl restart amir-pos
```

Smoke check: `systemctl is-active amir-pos` and `curl -s -o /dev/null -w '%{http_code}' -X POST https://erp.sabihasethnic.com/api/v1/auth/login -H 'Content-Type: application/json' -d '{"email":"...","password":"..."}'` → 200.

## Notes
- `migrate deploy` is safe here (it does NOT use the shadow DB that local `migrate dev` chokes on — see `pos-overhaul-log.md` gotchas).
- `JWT_EXPIRES_IN` in the prod `.env` is `8h` (was 15m — caused frequent logouts).
- Git remote: `git@kite.com:monkeyd21/amir-pos.git` (the box can't pull from it; that's why tarball transfer is used).
