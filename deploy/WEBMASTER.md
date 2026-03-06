# Orange Dollar Deployment Update

## Overview

This update deploys three components:
- **app** (app.odol.cash) — user-facing frontend → `/var/www/app.odol.cash/`
- **cabal** (cabal.odol.cash) — admin/CABAL frontend → `/var/www/cabal.odol.cash/`
- **server** — CABAL submission backend (Node.js, port 3001) → `/opt/od/server/`

All three read contract addresses and RPC URLs from a single shared `config.json`.

---

## 1. Unpack zips

```bash
cd /tmp
unzip /home/mwaddip/projects/od/od-app.zip
unzip /home/mwaddip/projects/od/od-cabal.zip
unzip /home/mwaddip/projects/od/od-cabal-server.zip
```

## 2. Deploy shared config (single source of truth)

```bash
mkdir -p /opt/od/shared
cp /tmp/shared/config.json /opt/od/shared/config.json
```

Edit `/opt/od/shared/config.json` if addresses differ from testnet defaults.

## 3. Deploy user app (app.odol.cash)

```bash
rm -rf /var/www/app.odol.cash/*
cp -r /tmp/app/dist/* /var/www/app.odol.cash/

# Symlink config.json into the app's static root
ln -sf /opt/od/shared/config.json /var/www/app.odol.cash/config.json
```

## 4. Deploy cabal admin (cabal.odol.cash)

```bash
rm -rf /var/www/cabal.odol.cash/*
cp -r /tmp/cabal/dist/* /var/www/cabal.odol.cash/

# Symlink config.json into the cabal's static root
ln -sf /opt/od/shared/config.json /var/www/cabal.odol.cash/config.json
```

## 5. Deploy CABAL server

```bash
rm -rf /opt/od/server/dist
cp -r /tmp/server/dist /opt/od/server/dist
cp /tmp/server/package.json /opt/od/server/package.json
cp /tmp/server/package-lock.json /opt/od/server/package-lock.json

# Copy vendored post-quantum dependency
mkdir -p /opt/od/vendor
cp -r /tmp/vendor/post-quantum /opt/od/vendor/post-quantum

# Install production dependencies
cd /opt/od/server
npm ci --omit=dev --legacy-peer-deps
```

## 6. Configure server .env

```bash
# Only if first time — don't overwrite existing .env with secrets
cp -n /tmp/server/.env.example /opt/od/server/.env
chmod 600 /opt/od/server/.env
```

Edit `/opt/od/server/.env`:

```
# Passphrase to protect wallet generation (set before first start)
WALLET_PASSPHRASE=<choose-a-strong-passphrase>

# Combined ML-DSA-44 public key from DKG ceremony (1312-byte hex)
PERMAFROST_PUBLIC_KEY=<from-ceremony>

# Network: testnet or mainnet
OPNET_NETWORK=testnet

# Port
PORT=3001

# Leave empty — auto-generated via /api/cabal/generate-wallet
ECDSA_PRIVATE_KEY=
```

## 7. Nginx configuration

### app.odol.cash

```nginx
server {
    listen 443 ssl;
    server_name app.odol.cash;

    root /var/www/app.odol.cash;
    index index.html;

    # Serve config.json (follows symlink to /opt/od/shared/config.json)
    location = /config.json {
        add_header Cache-Control "no-cache, must-revalidate";
        try_files $uri =404;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }

    # SSL certs...
}
```

### cabal.odol.cash

```nginx
server {
    listen 443 ssl;
    server_name cabal.odol.cash;

    root /var/www/cabal.odol.cash;
    index index.html;

    # Serve config.json (follows symlink to /opt/od/shared/config.json)
    location = /config.json {
        add_header Cache-Control "no-cache, must-revalidate";
        try_files $uri =404;
    }

    # Proxy CABAL API to Node.js server
    location /api/cabal/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Host $host;
        proxy_read_timeout 120s;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }

    # SSL certs...
}
```

**Important:** Nginx must follow symlinks. The default `disable_symlinks off` is fine.
The `no-cache` header on `config.json` ensures browsers always fetch the latest addresses.

```bash
nginx -t && systemctl reload nginx
```

## 8. Systemd service (if not already installed)

```bash
cat > /etc/systemd/system/od-cabal-server.service << 'EOF'
[Unit]
Description=OD CABAL Submission Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/od/server
EnvironmentFile=/opt/od/server/.env
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now od-cabal-server
systemctl status od-cabal-server
```

If already running, just restart:
```bash
systemctl restart od-cabal-server
```

## 9. Generate signing wallet

After the DKG ceremony is complete and `PERMAFROST_PUBLIC_KEY` is set:

1. Open cabal.odol.cash in the browser
2. Enter the `WALLET_PASSPHRASE` in the "Generate Signing Wallet" card
3. Click "Generate" — the server creates an ECDSA key and saves it to `.env`
4. Fund the returned P2TR address (opt1p...) with BTC for gas fees
5. Transfer contract ownership to the PERMAFROST address (deployer does this once)

The `ECDSA_PRIVATE_KEY` is auto-generated and should never be edited manually.

## 10. Verify

```bash
# Check wallet status
curl -s localhost:3001/api/cabal/wallet-status | jq .

# Verify config.json is served
curl -s https://app.odol.cash/config.json | jq .
curl -s https://cabal.odol.cash/config.json | jq .
```

## Updating addresses later

To change contract addresses or RPC URLs without rebuilding:

```bash
# Edit the single config file
nano /opt/od/shared/config.json

# No restart needed for frontends — browsers fetch config.json on each page load
# Restart server to pick up new addresses:
systemctl restart od-cabal-server
```
