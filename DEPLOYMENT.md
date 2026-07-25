# VPS Deployment Guide

This guide is stored here for safekeeping, but it applies to the entire Gaza40+ project (both Frontend and Backend).

## 🚀 How to Deploy on a New VPS

Since we aren't using a separate infrastructure repository, you will store the master `docker-compose.yml` here in the backend. 
When setting up a server, you'll create a common folder, clone both repos, and pull the compose file out.

### Step-by-Step Server Setup

**1. Create a Master Folder & Clone**
SSH into your server and run:
```bash
# Create a common folder and enter it
mkdir GAZA_40_PLUS
cd GAZA_40_PLUS

# Clone your repositories side-by-side
git clone <your-backend-repo-url> Gaza40-Student-Portal
git clone <your-frontend-repo-url> gaza40plus-frontend
```

**2. Extract the Docker Compose File**
Copy the compose file out of the backend repo so it sits at the root of the master folder:
```bash
cp Gaza40-Student-Portal/docker-compose.yml .
```

**3. Setup Environment Variables**
Create your secure `.env` files on the server (do this BEFORE building):
```bash
# Backend Env
nano Gaza40-Student-Portal/.env
# (Paste backend vars, Ctrl+O, Enter, Ctrl+X)

# Frontend Env
nano gaza40plus-frontend/.env
# (Paste frontend vars, Ctrl+O, Enter, Ctrl+X)
```

**4. Build and Run**
Make sure you are in the `GAZA_40_PLUS` folder (where the `docker-compose.yml` is) and run:
```bash
docker compose up -d --build
```

Your Next.js app is now running on port 3000 and talking to your backend on port 8000 internally!
