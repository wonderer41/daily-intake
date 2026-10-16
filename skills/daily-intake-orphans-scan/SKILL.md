---
name: daily-intake-orphans-scan
description: Push the orphaned-media list (Sonarr and Radarr files that need a manual review) and the container-scan result to the Daily Intake dashboard's banner.
version: 1.0.0
license: MIT
required_environment_variables:
  - name: DAILY_INTAKE_URL
    prompt: Daily Intake dashboard URL
    help: Where you reach the dashboard, for example http://127.0.0.1:4849 when it runs on the same host.
  - name: DAILY_INTAKE_TOKEN
    prompt: Daily Intake token
    help: The same value as HERMES_DASHBOARD_TOKEN in the dashboard's env file.
metadata:
  hermes:
    tags: [daily-intake, dashboard, homelab]
---

# Daily Intake: orphans and scan snapshots

Load the `daily-intake` skill first. It has the connection, reading state, keys and status codes. This skill only adds the orphans and scan snapshots on the banner.

## Orphans

`PUT /api/hermes/banner/orphans`

```json
{ "capturedAt": "2026-10-15T06:30:00-06:00",
  "items": [{ "name": "The Expanse S02E04", "kind": "episode", "arr": "sonarr" }, { "name": "Arrival (2016)", "kind": "movie", "arr": "radarr" }],
  "counts": { "sonarr": 1, "radarr": 1 } }
```

- `kind` is `episode` or `movie`, and `arr` is `sonarr` or `radarr`.
- Names only, at most 200 items.

## Scan

`PUT /api/hermes/banner/scan`

```json
{ "capturedAt": "2026-10-15T06:00:00-06:00", "ranAt": "2026-10-15T06:00:00-06:00", "up": 41, "total": 42,
  "issues": [{ "container": "jellyfin", "summary": "Restarted 3 times since midnight" }] }
```

- `up` can't be greater than `total`.
- Give each issue a one-line `summary`.

## Both snapshots

- Unknown fields are rejected at every level.
- Each new `capturedAt` stores a new snapshot (`201`), and the page shows the newest one. If you send the same `capturedAt` again with the same payload, nothing changes (`200`). If you send it with a different payload, that capture is replaced.
