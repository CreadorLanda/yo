# 🚢 Deployment

---

## Topologia em diagrama

```
┌──────────────── VPS (Oracle Ampere, 4 cores / 24 GB) ───────────────┐
│                                                                     │
│  Caddy (auto-TLS, Let's Encrypt) ── 80/443                          │
│         │                                                           │
│         ▼                                                           │
│  Go API  (systemd unit, :8080 em localhost)                         │
│         │                                                           │
│         ├─ Redis (Docker, :6379 em localhost) — filas, presença     │
│                                                                     │
└─────────────────────────────────────────┬───────────────────────────┘
                                          │  pgx sobre TLS (porta 6543)
                                          ▼
                              ┌────────────────────────┐
                              │  Supabase Postgres     │
                              │  + backups automáticos │
                              │  + PITR no Pro         │
                              └────────────────────────┘
```

Porquê este split:

- **Backups importam mais no Postgres.** Apps de mensagens morrem mal sem a DB. O Supabase dá backups diários (free) e PITR (Pro) sem escreveres uma cron.
- **Uma VPS = um modelo mental.** SSH, `systemctl`, `docker compose`, feito. Sem service mesh, sem Kubernetes.

---

## O que precisas antes de começar

| Coisa             | Onde                                                                         | Custo |
|-------------------|------------------------------------------------------------------------------|-------|
| Um domínio        | Qualquer registrar (Cloudflare, Namecheap, Porkbun, …)                        | ~$10/ano |
| Projeto Supabase  | [supabase.com](https://supabase.com) → New project (free tier)                | $0 |
| Conta Oracle Cloud | [cloud.oracle.com](https://cloud.oracle.com) (VM Always-Free Ampere)         | $0 |
| Caddy na VPS      | `sudo apt install caddy`                                                     | $0 |
| Docker na VPS     | `curl -fsSL https://get.docker.com \| sh`                                     | $0 |
| Toolchain Go      | Só no teu laptop (o binário de prod é compilado e enviado)                   | $0 |

Se a Oracle Free não estiver disponível na tua região (capacidade Ampere é volátil), qualquer outra VPS pequena serve: Hetzner CX22 (~€4/mês), Contabo, Netcup, ou um droplet pequeno na DigitalOcean. Maior não é melhor para v0.

---

## Passo 1 — Postgres no Supabase

1. Cria um projeto Supabase. Escolhe a região mais perto da VPS (latência conta em cada pedido).
2. **Project Settings → Database → Connection string → URI**. Escolhe o separador *"Connection pooler"*, modo *"Transaction"*. Copia esse URL — termina em `:6543/postgres?sslmode=require`.
3. **Database → Extensions** — ativa `pgcrypto` (usamos para gerar UUIDs).
4. Aplica as migrações do schema:
   ```bash
   cd server
   # instala uma vez: https://github.com/golang-migrate/migrate
   POSTGRES_URL="postgresql://postgres.<ref>:<pwd>@aws-0-<região>.pooler.supabase.com:6543/postgres?sslmode=require" \
     make migrate-up
   ```
5. Sanity check no editor SQL do Supabase:
   ```sql
   SELECT count(*) FROM users; -- 0
   ```

Notas:
- **Usa a porta 6543 (pooler), não a 5432 (direta).** Ligações diretas esgotam rapidamente.
- **Nunca metas o URL no git.** Vive só em `/opt/yo/server/.env` na VPS, modo `600`.

---

## Passo 2 — Provisionamento da VPS

### 2.1 Criar a VM

Na Oracle Cloud:
1. Compute → Instances → Create instance.
2. **Imagem**: Canonical Ubuntu 22.04 (LTS).
3. **Shape**: VM.Standard.A1.Flex (Ampere) — começa com 2 OCPU / 12 GB RAM (podes escalar até 4 OCPU / 24 GB na quota always-free).
4. SSH keys: cola a tua chave pública.
5. **VCN / Networking**: default. Abre **80 e 443** na security list (egress all, ingress 22 + 80 + 443).
6. Boot volume: 50 GB chega bem.

DNS: aponta `api.<o-teu-domínio>` para o IP público da VM (registo A + AAAA se IPv6 estiver ativo).

### 2.2 Hardening base do SO (10 minutos)

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

Desativa SSH por password se ainda não o fizeste (`PasswordAuthentication no` em `/etc/ssh/sshd_config`, depois `sudo systemctl restart ssh`).

### 2.3 Docker + Caddy

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker ubuntu       # logout + login outra vez

sudo apt install -y caddy
sudo systemctl enable --now caddy
```

### 2.4 Utilizador ZwoSocial + diretorias

```bash
sudo useradd -r -s /usr/sbin/nologin -d /opt/yo yo
sudo mkdir -p /opt/yo/server/bin
sudo chown -R yo:yo /opt/yo
```

---

## Passo 3 — Redis na VPS

```bash
# (depois de clonar o repo para, e.g., /opt/yo/source)
cd /opt/yo/source/server
sudo docker compose -f deploy/docker/docker-compose.yml up -d redis
```

O compose liga Redis a `127.0.0.1:6379`, portanto nunca está exposto à internet.

No `.env`:
```
REDIS_URL=redis://localhost:6379/0
```

(Se preferires Upstash e saltar o container de Redis local, define `REDIS_URL=rediss://...upstash.io:6379` no `.env` e não arranques o serviço `redis`.)

---

## Passo 4 — Build, ship, run da API

### 4.1 Build do binário (no laptop)

```bash
cd server
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 \
  go build -trimpath -ldflags="-s -w" -o bin/api-linux-arm64 ./cmd/api
```

Usa `GOARCH=amd64` se a tua VPS for x86. Oracle Ampere é `arm64`.

### 4.2 Enviar os artefactos

```bash
scp bin/api-linux-arm64 ubuntu@<vps-ip>:/tmp/api
scp .env                ubuntu@<vps-ip>:/tmp/.env   # gerado localmente com valores de prod
ssh ubuntu@<vps-ip> '
  sudo install -o yo -g yo -m 755 /tmp/api /opt/yo/server/bin/api
  sudo install -o yo -g yo -m 600 /tmp/.env /opt/yo/server/.env
  rm /tmp/api /tmp/.env
'
```

### 4.3 Unit systemd

```bash
# ficheiro do repo: deploy/vps/yo-api.service
sudo cp /opt/yo/source/server/deploy/vps/yo-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now yo-api
sudo systemctl status yo-api
```

### 4.4 Reverse proxy Caddy

Edita `deploy/vps/Caddyfile` e substitui `api.yo.example` pelo teu domínio real.

```bash
sudo cp deploy/vps/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

O primeiro pedido dispara a emissão do certificado Let's Encrypt. Acompanha com `journalctl -u caddy -f`.

### 4.5 Smoke test

```bash
curl -s https://api.<o-teu-domínio>/api/healthz   # {"status":"ok"}
curl -s https://api.<o-teu-domínio>/api/readyz    # 200 com checks pg + redis
```

---

## Atualizações

Para enviar uma nova versão da API:

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

Migrações são aplicadas separadamente:

```bash
POSTGRES_URL="<supabase-pooler-url>" make migrate-up
```

Assim que `backend/dev` estiver estável, uma pequena GitHub Action faz isto em cada merge para `backend/base`.

---

## Backups

| O quê                 | Quem trata                                  | Frequência   |
|-----------------------|---------------------------------------------|--------------|
| Dados Postgres        | **Supabase** (automático)                   | Diário; PITR no Pro |
| Redis                 | Aceitamos perda no restart (estado efémero) | n/a          |
| `/opt/yo/server/.env` | Manual — guardar cópia num gestor de passwords | a cada mudança |

Drill de restore (faz uma vez antes de precisares):
1. Sobe um projeto Supabase novo.
2. No projeto antigo: SQL editor → `pg_dump` via tab "Backups" → descarrega.
3. No projeto novo: `psql < dump.sql`.
4. Atualiza `POSTGRES_URL` na VPS.
5. `sudo systemctl restart yo-api`.

---

## Monitoring (o mínimo)

```bash
sudo apt install -y prometheus-node-exporter
```

Node Exporter em `:9100` (firewall a localhost), depois push para uma conta Grafana Cloud free. Cinco minutos de setup, paz infinita.

Métricas aplicacionais do binário Go expostas em `/metrics` (a adicionar num follow-up de `backend/base`); scrape via Grafana Cloud ou um Prometheus pequeno na VPS.

---

## Projeção de custos

| Item              | Free?                  | Pago                                          |
|-------------------|------------------------|-----------------------------------------------|
| VPS (Oracle Free) | Sim, para sempre (com ressalvas) | Se indisponível: Hetzner CX22 ~€4/mês |
| Supabase Postgres | Sim (500 MB)           | Pro $25/mês quando saíres do free             |
| Caddy + TLS       | Sim                    | —                                             |
| Domínio           | —                      | ~$10/ano                                      |
| **Total para começar** |                  | **~$0–10/ano**                                 |
| **A 1k DAU**      |                        | **~$25–50/mês**                                |

---

## Ver também

- [Arquitetura](./architecture.md)
- [Backend (Go, MVC)](./backend-go.md)
- [Database](./database.md)
- [Encriptação](../security/encryption.md)
