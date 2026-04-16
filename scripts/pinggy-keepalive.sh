#!/bin/bash
# Self-reconnecting Pinggy tunnel for the backend (localhost:3000 → https://ccc.a.pinggy.link)
#
# Sessions occasionally drop; we reconnect after 10s (not immediately) so the
# server has time to fully release the previous session before we try again.
# We do NOT use the +force token suffix because that causes the new session
# to kick the old one while it's still "draining", which puts the server in a
# flip-flop state and kicks everything.

TOKEN="4zVN14zozRh"
TARGET_PORT=3000
RECONNECT_DELAY=10
LOG=/tmp/pinggy-keepalive.log
: > "$LOG"

echo "[$(date +%H:%M:%S)] pinggy-keepalive starting — target localhost:$TARGET_PORT"

while true; do
  echo "[$(date +%H:%M:%S)] Opening tunnel..."
  ssh \
    -p 443 \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o ServerAliveInterval=60 \
    -o ServerAliveCountMax=3 \
    -o ExitOnForwardFailure=yes \
    -o TCPKeepAlive=yes \
    -R 0:localhost:$TARGET_PORT \
    "${TOKEN}+force@a.pinggy.io" >> "$LOG" 2>&1

  ec=$?
  echo "[$(date +%H:%M:%S)] Tunnel closed (exit $ec). Reconnecting in ${RECONNECT_DELAY}s..."
  sleep "$RECONNECT_DELAY"
done
