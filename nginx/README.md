# nginx config

`portal.conf` is the source of truth for the reverse-proxy config in front of both the frontend
(`:3000`) and this backend (`:8000`) on the production VPS. It mirrors
`/etc/nginx/sites-enabled/portal` on the server exactly.

Splits traffic by path:
- `/` → Next.js frontend
- `/api/` → this backend
- `/socket.io/` → this backend (WebSocket upgrade)

## Changing nginx behavior

1. Edit `portal.conf` here.
2. Commit the change.
3. Run `../scripts/deploy-nginx.sh` to push it to the server, validate, and reload.

**Never hand-edit the file directly on the server.** If you do, the next deploy will silently
overwrite it — that's intentional, it's what keeps this file trustworthy as the source of truth.
This is exactly how the current `client_max_body_size 10M;` line ended up undocumented and almost
impossible to find: it only ever existed as a manual edit on the box.

## Deploy prerequisites

The deploy script authenticates with a dedicated SSH key (not the root account password). If a new
machine needs to run it, generate a keypair and append the public half to the VPS's
`~/.ssh/authorized_keys`, then point `NGINX_DEPLOY_KEY` at the private key (see
`scripts/deploy-nginx.sh` for the exact environment variables).
