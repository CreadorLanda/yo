# 🚢 Deployment

---

## Topology at a glance

```
┌──────────────── VPS (Oracle Ampere, 4 cores / 24 GB) ───────────────┐
│                                                                     │
│  Caddy (auto-TLS, Let's Encrypt) ── 80/443                          │
│         │                                                           │
│         ▼                                                           │
│  Go API  (systemd unit, :8080 on localhost)                         │
│         │                                                           │
│         ├─ Redis (Docker, :6379 on localhost) — queues, presence    │
│                                                                     │
└─────────────────────────────────────────┬───────────────────────────┘
                                          │  pgx over TLS (port 6543)
                                          ▼
                              ┌────────────────────────┐
                              │  Supabase Postgres     │
                              │  + automatic backups   │
                              │  + point-in-time on Pro│
                              └────────────────────────┘
```

Why split this way:

- **Backups matter most for Postgres.** Messaging apps die badly without their DB. Supabase gives you daily backups (free) and PITR (Pro) without you writing any cron.
- **One VPS = one mental model.** SSH in, `systemctl`, `docker compose`, done. No service mesh, no Kubernetes.

---

## What you need before you start

| Thing             | Where                                                                          | Cost |
|-------------------|--------------------------------------------------------------------------------|------|
| A domain          | Anywhere (Cloudflare, Namecheap, Porkbun, …)                                   | ~$10/yr |
| Supabase project  | [supabase.com](https://supabase.com) → New project (free tier)                  | $0 |
| Oracle Cloud account | [cloud.oracle.com](https://cloud.oracle.com) (Always-Free Ampere VM)         | $0 |
| Caddy on the VPS  | `sudo apt install caddy`                                                       | $0 |
| Docker on the VPS | `curl -fsSL https://get.docker.com \| sh`                                       | $0 |
| Go toolchain      | Only on your dev laptop (production binary is built and shipped)               | $0 |

If Oracle Free isn't available in your region (Ampere capacity is spotty), any other small VPS works: Hetzner CX22 (~€4/mo), Contabo, Netcup, or a small DigitalOcean droplet. Bigger isn't better for v0.

---

## Step 1 — Supabase Postgres

1. Create a new Supabase project. Pick the region closest to your VPS (latency matters for every request).
2. **Project Settings → Database → Connection string → URI**. Choose the *"Connection pooler"* tab, *"Transaction"* mode. Copy that URL — it ends in `:6543/postgres?sslmode=require`.
3. **Database → Extensions** — enable `pgcrypto` (we use it for UUID generation).
4. Apply the schema migrations:
   ```bash
   cd server
   # install once: https://github.com/golang-migrate/migrate
   POSTGRES_URL="postgresql://postgres.<ref>:<pwd>@aws-0-<region>.pooler.supabase.com:6543/postgres?sslmode=require" \
     make migrate-up
   ```
5. Sanity check via the Supabase SQL editor:
   ```sql
   SELECT count(*) FROM users; -- 0
   ```

Notes:
- **Use port 6543 (the pooler), not 5432 (direct).** Direct connections cap out fast.
- **Never put the URL in git.** Lives only in `/opt/yo/server/.env` on the VPS, mode `600`.

---

## Step 2 — VPS provisioning

### 2.1 Create the VM

On Oracle Cloud:
1. Compute → Instances → Create instance.
2. **Image**: Canonical Ubuntu 22.04 (LTS).
3. **Shape**: VM.Standard.A1.Flex (Ampere) — pick 2 OCPU / 12 GB RAM to start (you can scale up to 4 OCPU / 24 GB on the always-free quota).
4. SSH keys: paste your public key.
5. **VCN / Networking**: default. Open **80 and 443** in the security list (egress all, ingress 22 + 80 + 443).
6. Boot volume: 50 GB is plenty.

DNS: point `api.<your-domain>` to the VM's public IP (A record + AAAA if IPv6 is enabled).

### 2.2 Base OS hardening (10 minutes)

```bash
ssh ubuntu@<vps-ip>

sudo apt update && sudo apt -y upgrade
sudo apt install -y ufw fail2ban
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp
sudo ufw --force enable
sudo systemctl enable --now fail2ban
sudo timedatectl set-timezone UTC
```

Disable password SSH if you haven't already (`PasswordAuthentication no` in `/etc/ssh/sshd_config`, then `sudo systemctl restart ssh`).

### 2.3 Docker + Caddy

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker ubuntu       # log out + back in

sudo apt install -y caddy
sudo systemctl enable --now caddy
```

### 2.4 The ZwoSocial user + dirs

```bash
sudo useradd -r -s /usr/sbin/nologin -d /opt/yo yo
sudo mkdir -p /opt/yo/server/bin
sudo chown -R yo:yo /opt/yo
```

---

## Step 3 — Redis on the VPS

```bash
# (after cloning the repo to e.g. /opt/yo/source)
cd /opt/yo/source/server
sudo docker compose -f deploy/docker/docker-compose.yml up -d redis
```

The compose file binds Redis to `127.0.0.1:6379`, so it's never exposed to the public internet.

In `.env`:
```
REDIS_URL=redis://localhost:6379/0
```

(If you'd rather use Upstash and skip the local Redis container, just set `REDIS_URL=rediss://...upstash.io:6379` in the .env and don't start the `redis` service.)

---

## Step 4 — Build, ship, run the API

### 4.1 Build the binary (on your laptop)

```bash
cd server
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 \
  go build -trimpath -ldflags="-s -w" -o bin/api-linux-arm64 ./cmd/api
```

Use `GOARCH=amd64` if your VPS is x86. Oracle Ampere is `arm64`.

### 4.2 Ship the artifacts

```bash
scp bin/api-linux-arm64 ubuntu@<vps-ip>:/tmp/api
scp .env                ubuntu@<vps-ip>:/tmp/.env   # generated locally with prod values
ssh ubuntu@<vps-ip> '
  sudo install -o yo -g yo -m 755 /tmp/api /opt/yo/server/bin/api
  sudo install -o yo -g yo -m 600 /tmp/.env /opt/yo/server/.env
  rm /tmp/api /tmp/.env
'
```

### 4.3 systemd unit

```bash
# repo file: deploy/vps/yo-api.service
sudo cp /opt/yo/source/server/deploy/vps/yo-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now yo-api
sudo systemctl status yo-api
```

### 4.4 Caddy reverse proxy

Edit `deploy/vps/Caddyfile` and replace `api.yo.example` with your real domain.

```bash
sudo cp deploy/vps/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

First request triggers Let's Encrypt issuance. Watch `journalctl -u caddy -f`.

### 4.5 Smoke test

```bash
curl -s https://api.<your-domain>/api/healthz   # {"status":"ok"}
curl -s https://api.<your-domain>/api/readyz    # 200 with pg + redis checks
```

---

## Updates

To ship a new API version:

```bash
# laptop
cd server
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o bin/api-linux-arm64 ./cmd/api
scp bin/api-linux-arm64 ubuntu@<vps-ip>:/tmp/api

# vps
ssh ubuntu@<vps-ip> '
  sudo install -o yo -g yo -m 755 /tmp/api /opt/yo/server/bin/api
  sudo systemctl restart yo-api
'
```

Migrations are applied separately:

```bash
POSTGRES_URL="<supabase-pooler-url>" make migrate-up
```

Once `backend/dev` is stable, a tiny GitHub Action does this on every merge to `backend/base`.

---

## Backups

| What                  | Who handles it                              | How often    |
|-----------------------|---------------------------------------------|--------------|
| Postgres data         | **Supabase** (automatic)                    | Daily; PITR on Pro |
| Redis                 | We accept loss on restart (ephemeral state) | n/a          |
| `/opt/yo/server/.env` | Manual — keep a copy in a password manager | on change    |

Restore drill (do it once before you need it):
1. Spin up a fresh Supabase project.
2. In the old project: SQL editor → `pg_dump` via "Backups" tab → download.
3. In the new project: `psql < dump.sql`.
4. Update `POSTGRES_URL` on the VPS.
5. `sudo systemctl restart yo-api`.

---

## Monitoring (the minimum)

```bash
sudo apt install -y prometheus-node-exporter
```

Node Exporter on `:9100` (firewall it to localhost), then push to a free Grafana Cloud account. Five minutes of setup, infinite peace of mind.

Application metrics from the Go binary are exposed at `/metrics` (to be added in `backend/base` follow-up); scrape from Grafana Cloud or a tiny Prometheus on the VPS.

---

## Cost projection

| Item            | Free?            | Paid                                          |
|-----------------|------------------|-----------------------------------------------|
| VPS (Oracle Free) | Yes, forever (with caveats) | If unavailable: Hetzner CX22 ~€4/mo |
| Supabase Postgres | Yes (500 MB)    | Pro $25/mo when you outgrow free              |
| Caddy + TLS     | Yes              | —                                             |
| Domain          | —                | ~$10/year                                     |
| **Total to start** |               | **~$0–10/yr**                                  |
| **At 1k DAU**   |                  | **~$25–50/mo**                                 |

---

## See also

- [Architecture](./architecture.md)
- [Backend (Go, MVC)](./backend-go.md)
- [Database](./database.md)
- [Encryption](../security/encryption.md)
