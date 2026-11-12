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

6. Open `https://cdn.example.com`, sign in, create apps and variants. The Settings page holds the
   grace period (60 minutes by default) during which the release a new version replaced stays on
   the host and on the nodes so that downloads in progress can finish; afterwards it is deleted
   everywhere.

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
   the `konmai_json` log format and both `access_log syslog:...` lines: every byte they report
   counts toward the node's bandwidth, whatever the path or status, and the `ip` field feeds the
   dashboard's "Traffic by IP" statistics. Nodes set up with an older `node.conf` keep counting
   bandwidth but report no addresses until their `log_format` includes `"ip":"$remote_addr"`.
4. `systemctl enable --now konmai-node`. Within a few seconds the dashboard shows the agent
   connected; within five minutes the probe marks the node online and the first files arrive.

A node never fills its disk: `minFreeBytes` (default 2 GiB, minimum 1 GiB) stays free. A release
is only fetched if it fits above that reserve, and a download in progress stops, deletes its
partial file and reports "skipped, no space" if other data shrinks the free space while it runs.
`maxStorageBytes` additionally caps how much the node stores in total.

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
and `google` holds the default device codenames to try (oldest Android version first, whatever
order they are listed in), a locale such as `ja_JP` and an IANA timezone such as `Asia/Tokyo`.
Device codenames come from the
submodule's `gpapi/device.properties` (up to `walleye`, Android 9) plus the newer profiles in
`downloader/src/gpapi/devices.properties`: `op_8_pro` (Android 10), `sm_s20_plus` (Android 13)
and `nothing_p1` (Android 14).

Then add at least one Google account, each under a short alias the dashboard shows. Google
refuses password and app-password logins for many accounts (`BadAuthentication`), so the
downloader signs in with a one-time browser token instead:

```sh
D="sudo -u konmai uv run konmai-downloader --config /etc/konmai/downloader.json"
$D account add main player@gmail.com     # --password signs in with the password instead
$D account list
$D account login main                    # again, after Google revoked the token
$D account rename main primary
$D account remove primary
```

`account add` explains how to copy the `oauth_token` cookie from
`https://accounts.google.com/EmbeddedSetup`, exchanges it for a long-lived master token stored in
`credentialsFile`, checks every default device in with Google, and reads one Play listing per
device to prove the session works. The running downloader picks up account changes within
`pollSeconds` and reports them to the host, where the **Downloader** page lists them. A
credentials file written by the old single-account `login` command is read as one account whose
alias is the part of the email before `@`; `google.email` and `google.password` are ignored.

Each Google Play variant tries every device (oldest Android version first) with every account
(in the order they were added): `(dev1, acc1)`, `(dev1, acc2)`, `(dev2, acc1)`, … The first pair
that works is saved as the variant's **Device** and **Account** in the dashboard and is used from
then on; it is shown per variant on the **Apps** page. With only one of the two set, only the
other is tried in turn. With both set, a failure is not retried with other pairs: the host
e-mails once when the failures begin, and clearing either field in the variant form starts the
search again.

`systemctl enable --now konmai-downloader` starts the loop. Every `pollSeconds` it asks the
host which variants are due and checks only those. Each variant's interval is set in the
dashboard, from every 5 minutes to once a day (the default); **Check now** makes a variant due
immediately. The old `dailyAt` setting is ignored. One-off runs:

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
