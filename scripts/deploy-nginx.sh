#!/usr/bin/env bash
# Deploys nginx/portal.conf (the tracked source of truth) to the VPS, validates it,
# and reloads nginx. Never hand-edit the config on the server — run this instead.
#
# Env vars (all optional, shown with defaults):
#   NGINX_DEPLOY_HOST   169.58.74.15
#   NGINX_DEPLOY_USER   root
#   NGINX_DEPLOY_KEY    ~/.ssh/gaza40_deploy
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_CONF="$SCRIPT_DIR/../nginx/portal.conf"

HOST="${NGINX_DEPLOY_HOST:-169.58.74.15}"
USER="${NGINX_DEPLOY_USER:-root}"
KEY="${NGINX_DEPLOY_KEY:-$HOME/.ssh/gaza40_deploy}"

REMOTE_AVAILABLE="/etc/nginx/sites-available/portal"
REMOTE_ENABLED="/etc/nginx/sites-enabled/portal"
REMOTE_STAGING="/etc/nginx/sites-available/portal.new"

if [[ ! -f "$LOCAL_CONF" ]]; then
  echo "error: $LOCAL_CONF not found" >&2
  exit 1
fi

ssh_opts=(-i "$KEY" -o BatchMode=yes -o ConnectTimeout=10)

echo "==> Uploading nginx/portal.conf to $USER@$HOST:$REMOTE_STAGING"
scp "${ssh_opts[@]}" "$LOCAL_CONF" "$USER@$HOST:$REMOTE_STAGING"

echo "==> Validating and applying on the server"
ssh "${ssh_opts[@]}" "$USER@$HOST" bash -s <<'REMOTE_SCRIPT'
set -euo pipefail

REMOTE_AVAILABLE="/etc/nginx/sites-available/portal"
REMOTE_ENABLED="/etc/nginx/sites-enabled/portal"
REMOTE_STAGING="/etc/nginx/sites-available/portal.new"

backup="${REMOTE_AVAILABLE}.bak.$(date +%s)"
if [[ -f "$REMOTE_AVAILABLE" ]]; then
  cp "$REMOTE_AVAILABLE" "$backup"
  echo "Backed up previous config to $backup"
fi

mv "$REMOTE_STAGING" "$REMOTE_AVAILABLE"

# Restore the standard sites-available/sites-enabled symlink convention.
# (sites-enabled/portal had drifted into being its own independent file, which is how
# this config silently diverged from sites-available/portal in the first place.)
rm -f "$REMOTE_ENABLED"
ln -s "$REMOTE_AVAILABLE" "$REMOTE_ENABLED"

if nginx -t; then
  systemctl reload nginx
  echo "nginx reloaded successfully."
  echo "==> client_max_body_size now in effect:"
  nginx -T 2>/dev/null | grep -i client_max_body_size || echo "(not set)"
else
  echo "nginx -t FAILED — rolling back" >&2
  if [[ -f "$backup" ]]; then
    cp "$backup" "$REMOTE_AVAILABLE"
    nginx -t && systemctl reload nginx
    echo "Rolled back to previous config." >&2
  fi
  exit 1
fi
REMOTE_SCRIPT

echo "==> Done."
