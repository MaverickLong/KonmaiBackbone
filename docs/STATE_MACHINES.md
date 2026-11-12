# Implicit state machines

Where the code keeps something that can be in one of several conditions and moves between them,
but never says so in one place. Each entry names the subject, where its state lives, the states as
the code spells them, the transitions with the code that performs them, and what can go wrong.
Entries are grouped by the process that owns the state; the last section covers conversations
between processes. Written against commit `2c0a65c` on 2026-11-08 by reading every source file of
`host`, `node`, `shared`, `downloader`, `dashboard` and `website`.

"Implicit" here means one of: an enum or string column whose transitions are spread over several
files, a boolean or nullable timestamp standing in for a lifecycle, state carried by a map entry or
a timer or a library's `readyState`, state encoded by the existence of a row or a file, or the same
fact kept in two places that have to agree.

Two of the hazards below were live in production on 2026-11-08 and are fixed alongside this
document: the node `Link` could park itself in `CONNECTING` forever after a rejected upgrade (N1),
and the host mirrored agent connectivity into a column that went stale on every restart (H3).
Since then the host side of H1, H2, H5, H7 and H8 has been made explicit; each entry says how.

## Host

### H1. Release lifecycle

- Subject: `Release.state` (`host/src/db/entities.ts`). Explicit states; the transitions are now explicit too: every change goes through `moveRelease` in `host/src/catalogue/lifecycle.ts`, which holds the table of allowed moves and throws on anything else.
- Lives in: the database row plus the release directory under `<storage>/store`.
- States: `ingesting` → `active` → `retained` → `deleting` → (row removed).
- Transitions:
  - create as `ingesting`: `publishRelease`, before any file is moved.
  - `ingesting` → removed: the same function when moving a staged file fails.
  - `ingesting` → `active`, previous `active` → `retained`, older `active`/`retained` → `deleting`: the transaction in `publishRelease`.
  - `retained` → `deleting`: `expireRetained`, run every minute, once the successor has been active for the grace period from the Settings page (60 minutes by default). Nodes delete their copy with the next manifest.
  - any → `deleting`: `removeRelease` (admin `DELETE /variants/:id/releases/:version`).
  - `retained` → `active`: `promoteRetained` after an active release is removed by hand.
  - `ingesting` older than one hour → `deleting`: `sweepOrphans` in `host/src/stats/jobs.ts` (00:30 UTC).
  - `deleting` → removed, directory deleted: `deleteMarkedReleases`, called from publish, removal, expiry and the sweep.
- Hazards: the row is flushed before the files move and the activation transaction runs afterwards, so a crash in between leaves an `ingesting` row whose files already sit in the store; the sweep deletes both after an hour and the downloader has to fetch the package again. Store directories without a row are removed by the same sweep, so the file system copy converges within a day. A download of the replaced release that is still running when the grace period ends is cut off; the period exists to make that rare.

### H2. Node health

- Subject: `Node.status` with `lastHealthyAt`, `lastFailureAt`, `lastFailureReason`. The transitions are now one pure function, `nextHealth` in `host/src/nodes/prober.ts`; the prober only applies its result.
- Lives in: the database row; the e-mail throttle (`lastEmailAt`) and the `running` guard live in memory in `Prober`.
- States: `unknown` → `online` ⇄ `faulty`, and back to `unknown` only when an administrator re-enables the node.
- Transitions: healthy while `unknown` → `online` silently; healthy while `faulty` → `online` with a `recovered` event and e-mail; three failed attempts while not `faulty` → `faulty` with a `became_faulty` event and e-mail. Transitions within two minutes of the previous e-mail for the same node are logged without e-mail. `PATCH /nodes/:id` with `enabled: true` resets a disabled node to `unknown` and probes it right away.
- Derived state: a node is _routable_ when `enabled`, `status === 'online'` and not exhausted by the same `quotaView` the dashboard shows (`RoutableNodes.list`), cached for 30 s and dropped on every probe transition and node edit.
- Hazards: `lastEmailAt` is in memory, so a host restart re-arms the throttle. The probe reads `/files/health`, a file the agent writes at start (`Storage.prepare`) and nginx serves, so a node whose agent is dead still counts as `online`; that is intended (nginx keeps serving) but means `status` says nothing about the agent, and a node whose agent has never run is `faulty` until it does.

### H2a. Node existence

- Subject: `Node.deletedAt` (`host/src/db/entities.ts`).
- States: present → deleted (terminal; the row is never removed).
- Transitions: `DELETE /nodes/:id` (`host/src/http/admin/nodes.ts`) disconnects the agent, sets `deletedAt`, disables the node, replaces its token hash and deletes its holdings. Its traffic, downloads and events keep their rows, so statistics still name it; the dashboard appends "(deleted)".
- Consequences: every lookup that routes, probes or authenticates asks for `enabled`, which a deleted node never is; the admin API returns `404` for it and lists it only with `?includeDeleted=true`. The unique index on `domain` covers present nodes only, so the domain can be given to a new node.
- Hazard: nodes removed before this existed are gone; their raw downloads were set to "no node" and still count as served by the host.

### H3. Agent connection (the one that drifted)

- Subject: whether a node's agent currently holds a WebSocket to the host.
- Lived in three places: the `Gateway.connections` map (memory, `host/src/nodes/gateway.ts`), the `Node.agentConnected` column (database), and the `agent_connected`/`agent_disconnected` `HealthEvent` pairs (database).
- Transitions: `Gateway.accept` (new connection; a previous one for the same node is closed with code 4001 and its own close handler is ignored), `Gateway.closed` (socket closed for any reason), `Gateway.disconnect` (admin disable, token rotation, node removal: code 4000), `pingAll` (two missed pongs → `terminate`), `Gateway.close` on shutdown (code 1001).
- Hazard, confirmed in production: `main.ts` called `gateway.close()`, `orm.close()` and `process.exit(0)` in a row. The WebSocket `close` events, and with them `Gateway.closed` and its database writes, never ran, so every node connected at shutdown kept `agentConnected = true` and no `agent_disconnected` event was written. After the restart the map was empty while the column still said connected. `/api/admin/nodes` read the column, `/api/admin/overview` read the map, and the two dashboard pages disagreed. Fixed by removing the column, deriving `NodeView.agentConnected` from the map, writing the missing `agent_disconnected` event at the next start (`Gateway.recordMissedDisconnects`), and emptying the map before closing sockets on shutdown.
- Remaining implicit state: the event pairs are history, not state; `Prober.warnStaleAgents` reads the newest `agent_connected` event to decide whether to e-mail about an agent that has been away for a day, with a 24-hour in-memory throttle that a restart resets.

### H4. Variant check cycle

- Subject: when the downloader should look at a variant and what happened last time.
- Lives in: `Variant.checkRequestedAt`, `lastCheckedAt`, `lastCheckStatus` (`null` | `up_to_date` | `updated` | `failed`), `lastCheckError`, `checkIntervalMinutes`; the "due" state is derived in `isCheckDue` (`host/src/catalogue/checks.ts`).
- States: never checked (due), waiting (not due), due by interval, requested (due regardless of interval), plus the last outcome.
- Transitions: `POST /variants/:id/check`, `POST /variants/check-all`, creating a variant and editing its `source` set `checkRequestedAt`; the downloader's `POST /api/ingest/variants/:id/check-result` clears it and records the outcome; time alone moves waiting → due.
- Hazards: a request survives a downloader crash (it is cleared only by a result), which is the right failure mode. There is no "in progress" state on the host; two downloader instances would both pick up the same work list.

### H5. Downloader presence

- Subject: the singleton `DownloaderState` (`phase` `idle` | `checking` | `downloading`, `lastSeenAt`, pass timestamps and summary).
- Lives in: the database, written only by heartbeats (`POST /api/ingest/heartbeat`).
- Transitions: `Runner.run_pass` and `Runner.process` in `downloader/src/konmai_downloader/runner.py` send `idle` → `checking` → `downloading` → `idle`; the scheduler sends `idle` on every quiet poll.
- Derived state: `downloaderView` in `host/src/http/admin/stats.ts` reports `offline` instead of the last phase once no heartbeat arrived for ten minutes, so a downloader killed mid-pass no longer shows as `downloading` forever; the Overview tile and the Downloader page both read that.
- Hazard: a single very large download can exceed ten minutes between heartbeats and show as `offline` until the next one.

### H6. Holdings

- Subject: which files a node holds, as the host knows it.
- Lives in: `Holding` rows (`present` | `mismatch`); "absent" is the missing row.
- Transitions: `applyInventory` (`host/src/nodes/reports.ts`) deletes every row of the node and re-inserts from the full inventory, inside one transaction. Nothing else writes holdings; `syncResult` messages only produce `SyncEvent` rows.
- Hazards: between a node deleting a file (prune, deep verification) and its next inventory, the host still routes users to it; the agent sends an inventory after every reconcile, which keeps the window short while the agent is connected. While an agent is not connected its holdings freeze at their last report.

### H7. Quota adjustment

- Subject: a manual true-up of a node's bandwidth usage.
- Lives in: `Node.usageAdjustmentBytes` plus `usageAdjustmentPeriodStart`; the adjustment "applies" only while the stored period start equals the start of the current billing period. That rule, and the traffic sums it joins, live in one place now: `periodUsage` in `host/src/nodes/quota.ts`, used by the node list and by routing.
- States: none, applied, expired (implicit: the number is still stored but ignored).
- Transitions: `PATCH /nodes/:id` with `usageAdjustmentBytes` stamps the current period; the period rollover expires it without touching the row.
- Hazard: after rollover the settings form still shows the old number as if it counted; `QuotaView.adjustmentBytes` is the truthful value.

### H8. Routable node cache

- Subject: `RoutableNodes.cached` (`host/src/routing/routable.ts`): empty, fresh (< 30 s), stale, or invalidated.
- Transitions: `list()` fills it; `invalidate()` is called when a probe changes a status and from every admin node action, including any `PATCH /nodes/:id`.

### H9. Download statistics roll-up

- Subject: a day's downloads exist as raw `Download` rows, as a `DownloadSummary`, or both.
- Transitions: `rollUpDownloads` (00:10 UTC, `host/src/stats/jobs.ts`) recomputes summaries in SQL for every completed day still present in raw rows, then deletes raw rows older than the cut-off; `/stats/downloads` reads summaries before the cut-off and raw rows after it. The cut-off (`rawDownloadCutoff`) is a UTC midnight 90 days back, so no day is split between the two.

### H10. App icon

- Subject: `App.iconFileName` versus the file in `<storage>/icons` (`host/src/http/admin/apps.ts`).
- States: none, present, dangling (column set, file gone), orphan (file without a column).
- Transitions: `PUT /apps/:packageName/icon` removes the old file, writes the new one, then sets the column and flushes; `DELETE .../icon` and app deletion remove the file and clear the column.
- Hazard: a failure between the write and the flush leaves an orphan file; one between the removal and the flush leaves a dangling name that the public catalogue turns into a broken icon link. Low.

### H11. GeoIP reader

- Subject: `GeoIp.reader` is unset or loaded for a given file modification time (`host/src/routing/geoip.ts`); an hourly check reloads on change and keeps the old reader when the new file fails to parse.

### H12. Admin session

- Subject: a JWT issued by `POST /api/admin/session`, kept in `localStorage` by the dashboard (`dashboard/src/api/client.ts`).
- States: signed out, signed in, expired (discovered lazily: the first `401` clears the token and redirects to `/login`).

## Node agent

### N1. Link to the host

- Subject: the `ws` client inside `Link` (`node/src/link.ts`): `CONNECTING` → `OPEN` → `CLOSING` → `CLOSED`, plus the `stopped` flag, the exponential backoff and the 90-second silence timer.
- Transitions: `start`/`connect` open a socket; `open` resets the backoff and arms the silence timer; every `ping` or message re-arms it; silence → `terminate`; `close` → `scheduleReconnect` unless stopped; `stop` closes with 1000 and cancels a pending reconnect.
- Hazard, confirmed in production: the `unexpected-response` listener. `ws` only aborts a handshake that got a non-101 answer when nobody listens for that event; with the listener in place a `502` from nginx (the host restarting), and equally a `401` after a token rotation or a `426` after a protocol bump, left the socket in `CONNECTING` with no `error`, no `close`, no reconnect and no silence timer (it is armed only after `open`). Traffic reports, manifests and inventories stopped until somebody restarted the process; nginx on the node kept serving, so the probe kept the node `online`. Fixed by leaving the event unhandled (the failure now surfaces as `error` then `close` 1006), adding a 30-second `handshakeTimeout`, and cancelling a pending reconnect in `stop()`.

### N2. Traffic bucket delivery

- Subject: each hourly `TrafficBucket` and each per-day `AddressBucket` (`node/src/traffic.ts`).
- Lives in: the in-memory `pending` maps (last 30 s), SQLite rows with an `acknowledged` flag, and the in-memory `sent` map of reports awaiting an `ack`.
- States: accumulating → stored, unacknowledged → in flight → acknowledged → deleted after 48 h; any growth after a send puts the row back to unacknowledged, and the matching `ack` is ignored because `acknowledge` only marks rows whose totals still equal what was sent.
- Transitions: `flush` (every 30 s, and before each report), `report` (every 5 min, only while the link is open), `acknowledge` (host `ack` with the report id), the retention delete at the start of `report`.
- Hazards: unacknowledged rows are kept forever and re-sent on every report, which is what makes the gap of a parked agent back-fill once it reconnects (the host upserts, so re-sent totals replace rather than add). The `sent` map is cleared on disconnect and capped at 20 entries, so a report acknowledged after a reconnect is simply re-sent later. A syslog line whose `ip` field fails validation is dropped as a whole, bytes included.

### N3. Local files and releases

- Subject: what the node holds on disk.
- Lives in: `LocalFile` and `LocalRelease` rows whose existence is the state, the `.part` suffix on disk for a download in progress, and the files themselves. `docs/PLAN.md` planned explicit `state` columns (`downloading` | `verified`, `fetching` | `complete`); the implementation encodes them this way instead.
- Transitions: `downloadFile` (`node/src/fetch.ts`) writes `<file>.part`, resumes it on the first attempt only, renames into place when size and hash match; `Reconciler.fetchRelease` upserts a `LocalFile` after each file and a `LocalRelease` after the last; `inventory()` forgets files whose size on disk changed; prune, `freeRetained`, `pruneOlderReleases`, `pruneReleasesNotInManifest` and the deep verifier delete files and rows.
- Hazards: between weekly deep verifications only the size is checked, so a corrupted file of the right size is reported as present and served. A crash between the rename and the `LocalFile` upsert leaves a complete file the node does not know about; the next reconcile re-downloads it over the top, so it heals at the cost of one transfer.

### N4. Reconcile loop

- Subject: `Reconciler.running`, `rerun`, `latest` manifest and `lastReconciled` fingerprint (`node/src/reconcile.ts`).
- States: no manifest yet, idle, running, running with another run requested.
- Transitions: `receive` stores the manifest and starts a run unless the fingerprint already reconciled cleanly; `run` loops while `rerun` is set; a failed reconcile leaves `lastReconciled` untouched so the same manifest is retried next time; the daily interval in `main.ts` re-runs against the cached manifest, which is why a parked agent still logs `reconciling` once a day.

### N5. Fetch attempts

- Subject: one file download inside `downloadWithRetries`: attempt 1 (resuming a `.part`), 2 and 3 with 5 s and 30 s pauses; failure kinds `hash`, `network`, `space`; `space` ends the release immediately and reports `skipped_no_space`.

### N6. Deep verification

- Subject: `DeepVerifier.job` (unscheduled or scheduled for a cron expression) and `running`; rescheduled only when the host sends a different expression.

## Downloader

### D1. Pass over the work list

- Subject: `Runner.process` per variant: heartbeat `checking` → optional `downloading` → check result `up_to_date` | `updated` | `failed`, summarised per pass.
- Hazard: see H5; an interruption that is not an exception (SIGKILL, power) leaves the host's phase stuck.

### D2. Host client retries

- Subject: `HostClient._request` (`downloader/src/konmai_downloader/host.py`): up to three attempts with 1 s, 5 s, 15 s pauses on connection errors and 5xx; 4xx are returned to the caller. `publish_release` turns a `409` into a second publish under `<version>-<versionCode>`.

### D3. Google sign-in

- Subject: `Credentials` (`downloader/src/konmai_downloader/credentials.py`) and `GooglePlaySource` sessions, per account.
- States: account added (`account add`, master token stored) → device checked in with that account (`gsfId` stored per account and device) → Play session open (cached per account/device/locale/timezone in `play_sessions`) → session failed (dropped from the cache, re-minted next time) → device re-checked-in once when opening it fails with a stored `gsfId`. `account login` replaces the token and keeps the check-ins; `account remove` drops both.
- Writers: the `account` commands and the running downloader both write the file; each change is made under a lock on a fresh read and replaces the file atomically, and the downloader reloads it when its inode, mtime or size change.
- Hazard: a revoked master token is never refreshed automatically; the account fails on every device until `konmai-downloader account login` is run again. Variants without a pinned account move on to the next account.

### D3a. Google Play combination per variant

- Subject: `device` and `account` in a `googleplay` source (`GooglePlaySource._settings`, `recordCheckResult` in `host/src/catalogue/checks.ts`).
- States: searching (neither set: every device × account pair, devices oldest first) → partly pinned (one set by the operator: only the other is iterated) → pinned (both set; saved by the host from the `compatibility` of the first successful check, or by the operator) → pinned and failing (no other pair is tried; the check result carries `alert`, and the host e-mails on the transition from not failing to failing) → back to pinned on the next success, or to searching / partly pinned when the operator clears a field.
- Hazard: a fetch may succeed with a later pair than the check did (the listing is readable but the download is not); the pair saved is the one the fetch used.

### D4. Staging directory

- Subject: `ReleaseDirectory` (`downloader/src/konmai_downloader/staging.py`): created fresh (an existing one is removed), filled, handed to the host (which renames the files out), discarded on success or failure.

### D5. Upstream version between check and fetch

- Subject: the `RemoteVersion` a source returned from `check` and what `fetch` downloads a moment later.
- Hazard: the GitHub and Arcaea sources query "latest" again inside `fetch`, so a release published in between is downloaded and published under the version string of the one that was checked. Google Play pins the version code it checked and is immune.

## Dashboard and website

### F1. Polling and freshness

- Live queries (`overview`, `nodes`, `node`, `variant`, `downloader`, `events`) refetch every 15 s; the statistics queries (`downloads`, `traffic`, `addresses`) never refetch, so the charts show whatever was loaded when the page mounted.

### F2. `ConfirmButton`

- Subject: `armed` with a four-second disarm timer (`dashboard/src/components/common.tsx`); the timer is not cleared on confirm or unmount.

### F3. First-visit notice

- Subject: `konmai.noticeSeen` in `localStorage` (`website/src/components/FirstVisitNotice.tsx`): unseen → seen; private mode shows it every time.

Other React state (open modals, form buffers, expanded rows, the colour scheme) is ordinary component state with no meaning outside the page and is left out.

## Conversations between processes

### P1. Host ⇄ node session

1. Upgrade: wrong protocol header → `426`; bad or disabled token → `401`; otherwise `Gateway.accept`, closing any previous session of the node with `4001`.
2. Host pushes a `manifest`; node sends `hello` (version, storage) and a full `inventory` plus `storage`; host answers the inventory with a `manifest` tailored to the node (allow-list, ordering by how many nodes already hold each variant).
3. Node reconciles and reports `syncResult`s; every 5 minutes it sends `traffic` and expects an `ack` carrying the report id; a `resync` from the host makes the node send a fresh inventory and reconcile.
4. Liveness: host pings every 30 s and terminates after two missed pongs; node terminates after 90 s without a frame.
5. Close codes: `1000` agent stopping, `1001` host shutting down, `4000` disconnected by host (disable, token rotation, removal), `4001` replaced by a newer connection, `1006` abnormal (handshake aborted, terminate, network).

- Manifests after a catalogue change are pushed fire-and-forget to open sockets; a node that misses one catches up with its next inventory (after every reconcile, at least daily), because the host answers every inventory with a manifest.
- Hazards: N1 and H3 above. After a token rotation or protocol bump the node now retries with backoff (at most every 60 s) and logs `Unexpected server response: 401` or `426` until its config is updated; before the fix it simply parked.

### P2. Downloader ⇄ host

- `GET /api/ingest/variants` is the work list (with `checkDue`), `POST .../check-result` closes a check, `POST /api/ingest/releases` publishes (`201`, `409` on a duplicate version), `POST /api/ingest/heartbeat` drives H5. The downloader keeps no state of its own between passes.

### P3. User ⇄ host download

- `GET /d/:package/:variant/:version/:file` resolves `latest` to the `active` release or a pinned version to `active`/`retained` (the latter only during the grace period of H1), picks a routable holder (country, then catch-all, then anyone), and answers `302`, or serves the file itself via `X-Accel-Redirect` when no node qualifies; the `Download` row is written after the response.
