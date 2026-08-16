# Deployment / VPS replication

Everything the VPS needs that does **not** live in application code. Commit this
folder so a VPS rebuild is a copy-paste, not archaeology.

## Topology

```
nginx (host, :80/:443)  ──►  frontend container  localhost:3000
                        └──►  backend  container  localhost:8000   (/api/, /socket.io/)
domain: portal.gaza40plus.co.uk   (SSL via Let's Encrypt / certbot)
```

Repos sit side-by-side in one folder (see root `docker-compose.yml` header):

```
GAZA_40_PLUS/
  docker-compose.yml            # copied up from backend/
  backend/                      # backend  (this repo)
  frontend/                     # frontend
```

The folder names are load-bearing: `docker-compose.yml` points its build
contexts and `env_file` paths at `./backend` and `./frontend`. Clone into
those names, or update the compose file to match.

## nginx

`deploy/nginx/portal.conf` is the live site config. The `# managed by Certbot`
lines (listen 443 / ssl_certificate / the :80 redirect block) are added
automatically by `certbot --nginx`; if you run certbot on a fresh box it will
insert them for you, so on first setup you can start from the plain proxy block.

Install / update on the VPS:

```bash
sudo cp backend/deploy/nginx/portal.conf /etc/nginx/sites-available/portal
sudo ln -sf /etc/nginx/sites-available/portal /etc/nginx/sites-enabled/portal
sudo nginx -t && sudo systemctl reload nginx
```

The forwarded headers (`X-Forwarded-Proto` etc.) let the backend know requests
arrive over HTTPS — needed so it never builds `http://` links or mishandles
secure cookies.

## SSL (first time only)

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d portal.gaza40plus.co.uk
```

Renews itself via the certbot systemd timer.

## App

```bash
cd ~/GAZA_40_PLUS
docker compose up -d --build          # build + start both containers
docker compose up -d backend          # recreate just the backend (e.g. after .env change)
```

## Env

`.env` files live inside each repo folder and hold secrets — **not committed**.
Key domain-related values in `backend/.env`:

| var            | value                              | why                                            |
|----------------|------------------------------------|------------------------------------------------|
| FRONTEND_URL   | https://portal.gaza40plus.co.uk    | base for every email link + redirect. ONE line. |
| COOKIE_DOMAIN  | portal.gaza40plus.co.uk            | auth cookie scope                              |
| COOKIE_SECURE  | true                               | cookie only sent over HTTPS                    |

> Gotcha we hit: a second `FRONTEND_URL=http://<ip>:3000` line had been appended
> and (last-one-wins) overrode the domain, so verification emails pointed at the
> raw IP and logins silently failed. Keep exactly one `FRONTEND_URL`.
