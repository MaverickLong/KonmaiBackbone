# Deployment guide

Everything runs as plain processes behind an nginx you configure yourself. Each service reads one
`config.json`; the reference nginx server blocks and systemd units live in `deploy/`.

Assumed layout on every machine (adjust freely, only the config files care):

| Path                   | Purpose                          |
| ---------------------- | -------------------------------- |
| `/srv/konmai/app`      | clone of this repository         |
| `/etc/konmai/*.json`   | service configuration (mode 600) |
| `/srv/konmai/storage`  | host: staging, store and icons   |
| `/srv/konmai/files`    | node: served files               |
| `/srv/konmai/*.sqlite` | databases                        |

Requirements: Ubuntu 24.04 (or similar), nginx, Node.js 24 (for example from NodeSource or nvm
installed for the `konmai` user), `yarn` 1, and on the host additionally `uv` and `git`.

## Host

1. Clone and build:

   ```sh
   sudo useradd --system --home /srv/konmai --create-home konmai
   sudo -u konmai git clone --recurse-submodules <repo> /srv/konmai/app
   cd /srv/konmai/app && sudo -u konmai yarn install --frozen-lockfile && sudo -u konmai yarn build
   ```

2. Create `/etc/konmai/host.json` from `host/config.example.json`:

   ```sh
   cd /srv/konmai/app/host
   yarn cli hash-password '<admin password>'   # → admin.passwordHash
   yarn cli secret                             # → admin.jwtSecret
   yarn cli secret                             # → ingestToken (shared with the downloader)
   ```

   Set `publicUrl` to the public origin (e.g. `https://cdn.example.com`), `storageDirectory`,
   `databasePath`, the SMTP settings under `email`, and `geoip.databasePath` (next section).

3. GeoIP database (DB-IP Lite, CC BY 4.0, refreshed monthly; the host reloads it when the file
   changes, no restart needed):

   ```sh
   curl -sSL "https://download.db-ip.com/free/dbip-country-lite-$(date +%Y-%m).mmdb.gz" | gunzip > /srv/konmai/dbip-country-lite.mmdb
   ```

   Put the same command in a monthly cron job for the `konmai` user.

4. nginx: copy `deploy/nginx/host.conf` into `sites-available`, set `server_name`, certificates
   and paths, enable it, reload. The important parts are the `/api/ingest/` block (never public),
   the WebSocket block for `/api/nodes/ws`, `/store/` guarded by `auth_request`, and the internal
   `/internal/store/` location used for `X-Accel-Redirect`.

5. systemd: copy `deploy/systemd/konmai-host.service`, then
   `systemctl enable --now konmai-host`. Migrations run automatically at startup.

6. Open `https://cdn.example.com`, sign in, create apps and variants.

## Node

1. In the dashboard, **Nodes → Add node**: name, domain (the hostname users will be redirected
   to), countries, quota, reset day, timezone. Copy the token and the generated `config.json`
   from the dialog; the token is shown once.
2. On the VPS:

   ```sh
   sudo useradd --system --home /srv/konmai --create-home konmai
   sudo -u konmai git clone <repo> /srv/konmai/app
   cd /srv/konmai/app && sudo -u konmai yarn install --frozen-lockfile
   sudo -u konmai yarn workspace konmai-shared build && sudo -u konmai yarn workspace konmai-node build
   sudo mkdir -p /etc/konmai /srv/konmai/files && sudo chown konmai:konmai /srv/konmai/files
   sudo tee /etc/konmai/node.json   # paste the config from the dashboard
   ```

3. nginx: copy `deploy/nginx/node.conf`, set `server_name`, certificates and the files path. Keep
   the `access_log syslog:...` line: it is how bandwidth is measured.
4. `systemctl enable --now konmai-node`. Within a few seconds the dashboard shows the agent
   connected; within five minutes the probe marks the node online and the first files arrive.

The only things a node needs from the outside world are outbound HTTPS to the host and inbound
HTTPS from users. There is no inbound API on the node.

## Downloader (same machine as the host)

```sh
cd /srv/konmai/app/downloader
sudo -u konmai uv sync
sudo -u konmai uv run python scripts/generate_protobuf.py
```

Create `/etc/konmai/downloader.json` from `downloader/config.example.json`: the host URL is the
backend's loopback address, `ingestToken` must equal the host's, `stagingDirectory` must be
`<host storageDirectory>/staging` (same filesystem as the store, files are moved with `rename`),
and `google` holds the Play account (an app password) plus the device codenames to try in order
(`crackling` is API 26, `walleye` API 28 in the bundled `device.properties`).

`systemctl enable --now konmai-downloader` runs the daily loop; the dashboard's **Check now**
buttons are picked up within `pollSeconds`. One-off runs:

```sh
uv run konmai-downloader --config /etc/konmai/downloader.json run --once
uv run konmai-downloader --config /etc/konmai/downloader.json check <variant id>
uv run konmai-downloader --config /etc/konmai/downloader.json publish <packageName> <variant> <version> file...
```

The last form publishes hand-made releases for `manual` variants.

## Public website (Konmai Academy)

The site in `website/` is a static build that reads the catalogue from the host's public API
(`/api/public/apps`, CORS enabled) and links to `/d/…` and `/icons/…` on the host. Build it with
the host's public origin baked in and serve `website/dist` from any static web server:

```sh
VITE_API_BASE=https://cdn.example.com yarn workspace konmai-website build
```

nginx needs only `root /srv/konmai/app/website/dist; location / { try_files $uri /index.html; }`.
Leave `VITE_API_BASE` unset when the site is served from the same origin as the host.

## Updating

```sh
cd /srv/konmai/app && git pull --recurse-submodules && yarn install --frozen-lockfile && yarn build
systemctl restart konmai-host          # host
systemctl restart konmai-node          # node
cd downloader && uv sync && uv run python scripts/generate_protobuf.py && systemctl restart konmai-downloader
```

Migrations are applied on startup by the host and node processes.

## Checks after deployment

- `curl -I https://cdn.example.com/d/<package>/<variant>/latest/<file>` answers `302` with a
  node URL (or `200` from the host while no node holds the file yet).
- `curl -r 0-99 -o /dev/null -w '%{http_code}\n' <node URL>` prints `206`.
- `curl https://node1.example.com/files/health` prints the node id and agent version.
- Stop nginx on a node: within about five minutes the node turns faulty in the dashboard and the
  alert e-mail arrives; start it again and the recovery e-mail follows.
- `https://cdn.example.com/api/public/apps` lists the catalogue for the website.
