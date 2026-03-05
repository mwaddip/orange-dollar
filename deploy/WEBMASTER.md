# CABAL Server Deployment

## 1. Build

```bash
cd server
npm install --legacy-peer-deps
npm run build
```

## 2. Deploy files

```bash
rsync -av server/dist/ /opt/od/server/dist/
rsync -av server/node_modules/ /opt/od/server/node_modules/
cp server/package.json /opt/od/server/
```

## 3. Configure

```bash
cp server/.env.example /opt/od/server/.env
# Edit /opt/od/server/.env — fill in:
#   DEPLOYER_MNEMONIC (the deployer wallet mnemonic)
#   PERMAFROST_PUBLIC_KEY (hex-encoded ML-DSA-44 threshold public key)
#   Contract addresses (if different from testnet defaults)
chmod 600 /opt/od/server/.env
```

## 4. Systemd service

```bash
cp deploy/od-cabal-server.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now od-cabal-server
systemctl status od-cabal-server
```

## 5. Nginx reverse proxy

Insert the location block from `deploy/nginx-cabal-api.conf` into the existing
OD app server block (the one serving the static frontend).

```bash
# Edit /etc/nginx/sites-available/od (or equivalent)
# Add the location /api/cabal/ block
nginx -t && systemctl reload nginx
```

## 6. Verify

```bash
curl -s localhost:3001/api/cabal/build-step \
  -d '{"stepId":0,"params":{}}' \
  -H 'Content-Type: application/json' | jq .
```

Expected: `{ "messageHash": "...", "method": "setReserve", "contract": "0x..." }`
