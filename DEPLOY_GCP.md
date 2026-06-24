# Migrating the backend from Render to GCP (Compute Engine)

Why: Render's Starter tier OOM-crashed running Docling (512MB RAM, same as Free),
which also wiped the SQLite DB and uploads on every crash/restart. A Compute
Engine VM gives you a real persistent disk (nothing gets wiped) and RAM you
choose yourself. Frontend stays on Vercel — only the backend moves.

No code changes needed. Budget ~45-60 min the first time through.

## 0. Before you start

You'll need a Google Cloud account with billing enabled (new accounts get
free trial credit). Go to https://console.cloud.google.com, create a project
if you don't have one (top-left project dropdown → New Project).

## 1. Reserve a static IP

A static IP means the address doesn't change if the VM restarts — important
since we'll point DNS-like config at it.

VPC network → IP addresses → Reserve External Static IP Address.
- Name: `aperture-ip`
- Region: pick one close to you, e.g. `us-central1` (note the region, you'll reuse it)

Copy the IP it gives you (e.g. `34.123.45.67`) — you'll need it below.

## 2. Create the VM

Compute Engine → VM Instances → Create Instance.

- Name: `aperture-backend`
- Region/zone: same region as your static IP
- Machine type: **e2-medium** (2 vCPU, 4 GB RAM). Render's 512MB crashed on
  Docling — 4GB gives real headroom. (Roughly $24-30/month if left running
  24/7 in us-central1; you can stop the VM when not using it to pay only for
  the idle disk, a couple dollars/month.)
- Boot disk: click "Change" → Debian 12 (or Ubuntu 22.04, either is fine) → 20GB standard persistent disk
- Networking → Network interfaces → External IPv4 address → select the
  static IP you reserved (`aperture-ip`)
- Firewall: check **"Allow HTTP traffic"** and **"Allow HTTPS traffic"**

Click Create. Wait for the green checkmark.

## 3. SSH in

Click the "SSH" button next to your VM in the console — opens a browser
terminal, no key setup needed.

## 4. Install dependencies

```bash
sudo apt update
sudo apt install -y python3-pip python3-venv git

git clone https://github.com/karishmacdewan/aperture.git
cd aperture/ingestion-benchmark

python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[api,extraction,embedding,vectorstore]"
```

This step takes a few minutes (same Docling/torch dependencies as the
Render build).

## 5. Run it as a service (survives reboots and SSH disconnects)

```bash
sudo tee /etc/systemd/system/aperture.service > /dev/null <<'EOF'
[Unit]
Description=Aperture API
After=network.target

[Service]
Type=simple
User=YOUR_USERNAME
WorkingDirectory=/home/YOUR_USERNAME/aperture/ingestion-benchmark
Environment="ALLOWED_ORIGINS=https://aperture-teal-delta.vercel.app"
ExecStart=/home/YOUR_USERNAME/aperture/ingestion-benchmark/.venv/bin/uvicorn api.main:app --host 127.0.0.1 --port 8000
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF
```

Replace `YOUR_USERNAME` with your actual SSH username (run `whoami` to check
it) in all three places. Add `OPENAI_API_KEY=...` as another `Environment=`
line if you use OpenAI-backed components.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now aperture
sudo systemctl status aperture   # should say "active (running)"
```

Note this binds to `127.0.0.1` (localhost only) — that's intentional, Caddy
in the next step is what exposes it publicly over HTTPS.

## 6. Get HTTPS without owning a domain

Vercel serves your frontend over HTTPS, and browsers block a HTTPS page from
calling a plain-HTTP API. We need a real TLS cert, which normally needs a
domain — but **sslip.io** gives you a free hostname that resolves to any IP
you put in it, e.g. `34-123-45-67.sslip.io` resolves to `34.123.45.67`. Caddy
can get a real Let's Encrypt certificate for that automatically.

Replace dots with dashes in your static IP from step 1 to build this hostname.

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy

sudo tee /etc/caddy/Caddyfile > /dev/null <<EOF
34-123-45-67.sslip.io {
    reverse_proxy 127.0.0.1:8000
}
EOF

sudo systemctl restart caddy
```

Replace `34-123-45-67` with your actual IP (dashes, not dots). Caddy will
provision a free TLS cert the first time it starts — give it ~30 seconds.

Test from your own machine:

```bash
curl https://34-123-45-67.sslip.io/health
```

Should return `{"status":"ok"}`.

## 7. Point Vercel at the new backend

Vercel → your project → Settings → Environment Variables.
Update `NEXT_PUBLIC_API_BASE_URL` to `https://34-123-45-67.sslip.io` (your
actual sslip.io URL). Redeploy (Deployments tab → latest → "..." → Redeploy).

## 8. Test end to end

Open your Vercel app, upload a file, start a run. Since this VM has its own
disk (not wiped between requests like Render's free/Starter tiers) and 4GB
RAM (vs Render's 512MB), uploads and runs should persist normally and
Docling shouldn't crash the process.

## 9. Shut down Render (optional, to stop paying for it)

Render dashboard → aperture service → Settings → scroll down → Delete Web
Service. Do this only after confirming step 8 works.

## Ongoing costs / management

- Stop the VM (Compute Engine → VM instances → checkbox → Stop) when you're
  not using it — you'll only pay for the ~20GB disk (a couple dollars/month)
  instead of the full ~$24-30/month compute cost. Restart it before your
  next demo; same static IP and sslip.io URL keep working.
- To redeploy code changes: SSH in, `cd aperture/ingestion-benchmark`,
  `git pull`, `sudo systemctl restart aperture`.
