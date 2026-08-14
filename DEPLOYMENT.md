# VPS Deployment Guide

This guide is stored here for safekeeping, but it applies to the entire Gaza40+ project (both Frontend and Backend).

## 🚀 How to Deploy on a New VPS

Since we aren't using a separate infrastructure repository, you will store the master `docker-compose.yml` here in the backend. 
When setting up a server, you'll create a common folder, clone both repos, and pull the compose file out.

### Step-by-Step Server Setup

**1. Set up GitHub Authentication (One-time setup)**
The server needs an SSH key to clone your private repositories securely.
```bash
# Generate the key (press Enter to accept all defaults)
ssh-keygen -t ed25519 -C "contabo-server"

# Print the key to your terminal
cat ~/.ssh/id_ed25519.pub
```
*Copy the output and paste it into GitHub -> Settings -> SSH and GPG keys -> New SSH key.*

**2. Create a Master Folder & Clone**
SSH into your server and run:
```bash
# Create a common folder and enter it
mkdir GAZA_40_PLUS
cd GAZA_40_PLUS

# Clone your repositories side-by-side using SSH
git clone git@github.com:KaleemAhmed123/Gaza40-Student-Portal.git
git clone git@github.com:KaleemAhmed123/gaza40plus-frontend.git
```
*(If the terminal asks: `Are you sure you want to continue connecting (yes/no/[fingerprint])?`, you **MUST** type the word `yes` and press Enter, otherwise the connection will fail).*

**3. Extract the Docker Compose File**
Copy the compose file out of the backend repo so it sits at the root of the master folder:
```bash
cp Gaza40-Student-Portal/docker-compose.yml .
```

**4. Setup Environment Variables**
Create your secure `.env` files on the server (do this BEFORE building):
```bash
# Backend Env
nano Gaza40-Student-Portal/.env
# (Paste backend vars, Ctrl+O, Enter, Ctrl+X)

# Frontend Env
nano gaza40plus-frontend/.env
# (Paste frontend vars, Ctrl+O, Enter, Ctrl+X)
```

**5. Build and Run**
Make sure you are in the `GAZA_40_PLUS` folder (where the `docker-compose.yml` is) and run:
```bash
docker compose up -d --build
```

Your Next.js app is now running on port 3000 and talking to your backend on port 8000 internally!

---

## 🛠️ Known Gotchas & Troubleshooting History
*A record of issues faced during the initial deployment to Contabo and how they were solved.*

### 1. Docker Install fails on `apt-get update` (Ubuntu 24.04 Noble)
**Issue:** The official Docker installation script (`get-docker.sh`) fails because the VPS comes pre-configured with a broken `speedtest-cli` repository that prevents the system package list from updating.
**Fix:** Delete the broken repository link and re-run the script:
```bash
rm -f /etc/apt/sources.list.d/ookla_speedtest-cli.list && sh get-docker.sh
```

### 2. Environment Variables & Next.js Proxy
**Architecture:** Next.js proxies all `/api/` calls securely to the backend via the internal Docker network. We pass `BACKEND_API_URL=http://backend:8000` inside `docker-compose.yml` to make this happen.
- **Frontend (`NEXT_PUBLIC_API_URL`)**: This can be left completely empty! When empty, Axios calls `/api/...`, triggering the proxy.
- **Backend (`CORS_ORIGIN` & `FRONTEND_URL`)**: These must be set to the public frontend URL (e.g., `http://169.58.74.15:3000`) so the backend accepts requests and generates correct email links.

### 3. Prisma Schema Caching Bug during Docker Build
**Issue:** The backend `Dockerfile` failed to build because `pnpm install` triggered the `prisma generate` postinstall script before the `schema.prisma` file was copied into the container.
**Fix:** The Dockerfile was updated to copy the `prisma/` directory immediately *before* running `pnpm install`. If you ever rewrite the Dockerfile, remember to keep `COPY prisma ./prisma/` above the dependency installation!

### 4. Login Fails (401 Unauthorized right after success)
**Issue:** You log in, the API returns a 200 OK, but you get instantly kicked back to the login screen because the `/api/auth/me` check fails.
**Fix:** Browsers refuse to save secure cookies over plain HTTP. In your backend `.env`, set `COOKIE_SECURE=false` until you connect a domain name with an SSL (HTTPS) certificate.

### 5. Socket.io Infinite Polling / 404 Errors
**Issue:** Next.js proxies standard API routes perfectly, but drops WebSocket upgrades, causing Socket.io to infinitely poll and return 404s.
**Fix:** The frontend was updated to bypass the Next.js proxy for sockets. On the VPS, edit the frontend `.env` and add `NEXT_PUBLIC_SOCKET_URL=http://<VPS_IP>:8000`. This allows the socket to talk directly to the backend.

---

## 🌐 Custom Domain & HTTPS Setup (Nginx)

Once your IP is working, you will want to add a domain name. We use an advanced Nginx configuration to split traffic: `/` goes to the frontend container (port 3000), while `/api/` and `/socket.io/` bypass the Next.js proxy and route directly to the backend container (port 8000). This perfectly solves all WebSocket issues!

### 1. DNS Setup
Go to your domain provider (for `gaza40plus.co.uk`) and add an **A Record**:
- **Name/Host:** `portal`
- **Value/Target:** `169.58.74.15`

### 2. Install Nginx & Certbot
Run this on your server:
```bash
apt-get install nginx certbot python3-certbot-nginx -y
```

### 3. Configure Nginx

The nginx config is **tracked in this repo** at [`nginx/portal.conf`](nginx/portal.conf) — see
[`nginx/README.md`](nginx/README.md) for how it's organized. It is the source of truth; the file on
the server should always match it exactly.

For a first-time server setup, copy it into place manually once:
```bash
cp nginx/portal.conf /etc/nginx/sites-available/portal
ln -s /etc/nginx/sites-available/portal /etc/nginx/sites-enabled/portal
nginx -t && systemctl reload nginx
```

For every change after that, **do not hand-edit the file on the server.** Edit
`nginx/portal.conf` here, commit it, and run:
```bash
./scripts/deploy-nginx.sh
```
This uploads the file, validates it with `nginx -t`, reloads nginx, and automatically rolls back if
validation fails. See the script header for the `NGINX_DEPLOY_*` environment variables it reads
(host/user/SSH key), and `nginx/README.md` for how to provision a deploy key on a new machine.

### 4. Enable SSL
The config above already includes the frontend/API/WebSocket routing. Once it's live on port 80, get
a certificate (this also rewrites the file to add the SSL server block and HTTP→HTTPS redirect —
copy the result back into `nginx/portal.conf` afterward so the tracked file stays the source of
truth):
```bash
certbot --nginx -d portal.gaza40plus.co.uk
```

### 5. Final Environment Variables
Now that Nginx is routing everything securely through `https://portal.gaza40plus.co.uk`, lock down your variables.

**In Backend `.env`:**
```env
CORS_ORIGIN=https://portal.gaza40plus.co.uk
FRONTEND_URL=https://portal.gaza40plus.co.uk
COOKIE_DOMAIN=portal.gaza40plus.co.uk
COOKIE_SECURE=true
```

**In Frontend `.env`:**
```env
NEXT_PUBLIC_SOCKET_URL=https://portal.gaza40plus.co.uk
BACKEND_API_URL=http://backend:8000
# NEXT_PUBLIC_API_URL should be left completely empty!
```

Finally, run `docker compose up -d --build` to apply!
