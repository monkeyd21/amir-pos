#!/usr/bin/env python3
"""
Minimal SSH/SFTP helper for the prod box. Reads credentials from
deploy-secrets.local at the repo root (gitignored). Never prints the password.

  remote.py run  "<shell command>"     # run remotely, stream stdout/stderr, propagate exit code
  remote.py put  <local> <remote>      # upload a file over SFTP
"""
import os
import sys

import paramiko

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SECRETS = os.path.join(ROOT, "deploy-secrets.local")


def load_cfg():
    if not os.path.exists(SECRETS):
        sys.exit("deploy-secrets.local not found at repo root — copy deploy-secrets.local.example and fill it in")
    cfg = {}
    with open(SECRETS) as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                cfg[k.strip()] = v.strip()
    missing = [k for k in ("DEPLOY_HOST", "DEPLOY_SSH_USER", "DEPLOY_SSH_PASSWORD") if not cfg.get(k)]
    if missing:
        sys.exit("deploy-secrets.local is missing: " + ", ".join(missing))
    return cfg


def connect(cfg):
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(
        cfg["DEPLOY_HOST"],
        username=cfg["DEPLOY_SSH_USER"],
        password=cfg["DEPLOY_SSH_PASSWORD"],
        timeout=30,
        look_for_keys=False,
        allow_agent=False,
    )
    return c


def do_run(c, command):
    # bash -lc so the remote PATH matches an interactive login (node/npm live there)
    chan = c.get_transport().open_session()
    chan.get_pty()
    chan.exec_command("bash -lc " + shell_quote(command))
    while True:
        data = chan.recv(4096)
        if not data:
            break
        sys.stdout.write(data.decode("utf-8", "replace"))
        sys.stdout.flush()
    return chan.recv_exit_status()


def shell_quote(s):
    return "'" + s.replace("'", "'\"'\"'") + "'"


def do_put(c, local, remote):
    sftp = c.open_sftp()
    size = os.path.getsize(local)
    sftp.put(local, remote)
    sftp.close()
    print(f"uploaded {local} -> {remote} ({size / 1024 / 1024:.1f} MB)")
    return 0


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    mode = sys.argv[1]
    c = connect(load_cfg())
    try:
        if mode == "run":
            rc = do_run(c, sys.argv[2])
        elif mode == "put":
            rc = do_put(c, sys.argv[2], sys.argv[3])
        else:
            sys.exit(f"unknown mode: {mode}")
    finally:
        c.close()
    sys.exit(rc)


main()
