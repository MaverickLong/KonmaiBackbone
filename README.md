# Konmai Backbone

A small self-hosted distribution system for large static files (game packages) across cheap VPS
nodes: one **host** keeps the canonical catalogue and answers every download with a `302` to a
healthy node in the user's country, **nodes** hold whatever fits on their disk and serve it with
nginx, a Python **downloader** keeps the catalogue current from Google Play / GitHub / vendor
APIs, and a **dashboard** shows what is going on.

| Directory     | What                                                         | License |
| ------------- | ------------------------------------------------------------ | ------- |
| `shared/`     | zod schemas and types shared by host, node and dashboard     | MIT     |
| `host/`       | Express + MikroORM backend: routing, admin API, node gateway | MIT     |
| `node/`       | node agent: reconcile, fetch, traffic accounting             | MIT     |
| `dashboard/`  | Vite + React + Mantine admin panel                           | MIT     |
| `website/`    | Vite + React + Mantine public download site (Konmai Academy) | MIT     |
| `downloader/` | Python worker publishing releases to the host                | GPLv3   |
| `deploy/`     | reference nginx configs and systemd units                    | MIT     |
| `docs/`       | deployment guide                                             | MIT     |

See `docs/DEPLOYMENT.md` for installing and operating the system.

## Development

Requirements: Node.js 24 (`.nvmrc`), yarn 1, `uv` with Python 3.11, and the `googleplay-api`
submodule (`git submodule update --init`).

```sh
yarn install
yarn build                                 # shared → host → node → dashboard → website
yarn test                                  # vitest for shared, host and node
cd downloader && uv sync && uv run python scripts/generate_protobuf.py && uv run pytest
```

Running locally: create a `config.json` for the host from `host/config.example.json` (set
`behindNginx: false` so the backend serves files itself), start it with
`yarn workspace konmai-host dev -- --config path/to/config.json`, create a node in the dashboard
(`yarn workspace konmai-dashboard dev` proxies to `KONMAI_HOST_URL`, default
`http://127.0.0.1:3000`), and start the agent with
`yarn workspace konmai-node dev -- --config path/to/node.json`. The public site runs with
`yarn workspace konmai-website dev` (also proxied to `KONMAI_HOST_URL`).

Formatting: `yarn format` (Prettier) and `uv run autopep8 --in-place --recursive src tests`.
