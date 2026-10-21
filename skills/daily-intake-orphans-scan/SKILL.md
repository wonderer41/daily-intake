---
name: daily-intake-orphans-scan
description: Push the orphaned-media list (Sonarr and Radarr files that need a manual review) and the container-scan result to the Daily Intake dashboard's banner, and raise orphans left unfixed for two checks and serious container problems in Important. Use from the weekly orphan check and the daily container health scan.
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

Load the `daily-intake` skill first. It has the connection, reading state, keys and status codes. This skill only adds the orphans and scan snapshots on the banner, and the Important entries for orphans nobody fixed and for serious container problems.

## Orphans

The orphan check runs once a week. It lists the files in the orphan folder that Sonarr or Radarr couldn't import, which the user fixes by hand. Each run:

1. `GET /api/hermes/state` **before** you push anything. Take `orphans` (the previous check's snapshot as `{ capturedAt, data }`, or `null`), `orphanLinks`, and the open `alerts` whose key starts with `orphans:`.
2. Push this check's snapshot (below).
3. Raise or resolve the Important entries (see "Raise it in Important").

### The snapshot

`PUT /api/hermes/banner/orphans`

```json
{ "capturedAt": "2026-10-15T06:30:00-06:00",
  "items": [{ "name": "The Expanse S02E04", "kind": "episode", "arr": "sonarr" }, { "name": "Arrival (2016)", "kind": "movie", "arr": "radarr" }],
  "counts": { "sonarr": 1, "radarr": 1 } }
```

- `kind` is `episode` or `movie`, and `arr` is `sonarr` or `radarr`.
- Names only, at most 200 items.

### Raise it in Important

An orphan that is still there at the **second check in a row** becomes an entry in Important, one per orphan. Load the `daily-intake-alerts` skill for the alert rules.

- An orphan was there at the previous check when the same `name` and `arr` are in `orphans.data.items`.
- If `orphans.capturedAt` is from today, this run repeats today's check: only resolve, don't raise anything.
- The key is `orphans:<arr>:<slug>`. The slug is the name in lowercase, with every run of other characters than `a-z` and `0-9` turned into one `-` and none at the ends. For example, `Arrival (2016)` becomes `orphans:radarr:arrival-2016`, and `The Expanse S02E04` becomes `orphans:sonarr:the-expanse-s02e04`.

`PUT /api/hermes/alerts/orphans%3Aradarr%3Aarrival-2016`

```json
{ "source": "orphans", "title": "Arrival (2016)", "detail": "Still in the orphan folder after 2 checks (first seen 2026-10-14)",
  "url": "https://radarr.example.com", "severity": "warning" }
```

- `title` is the orphan's name. `detail` gives the previous check's date (`orphans.capturedAt` as a local date) as when it was first seen.
- `url` is `orphanLinks.radarrUrl` for a movie and `orphanLinks.sonarrUrl` for an episode. Leave it out when that link is `null`.
- If the orphan's alert is already open, leave it as it is.
- Resolve every open `orphans:` alert whose orphan is not in this check's list: `POST /api/hermes/alerts/<key>/resolve`.

## Scan

The daily container health scan (06:00) reads every container's logs and reports to the user's chat. At the end of that run, also update the dashboard:

1. `GET /api/hermes/state`. Take the open `alerts` whose key starts with `container:`.
2. Push the scan snapshot (below).
3. Raise the serious problems in Important, and resolve the ones that are gone (see "Raise it in Important" below).

### The snapshot

`PUT /api/hermes/banner/scan`

```json
{ "capturedAt": "2026-10-15T06:00:00-06:00", "ranAt": "2026-10-15T06:00:00-06:00", "up": 41, "total": 42,
  "issues": [{ "container": "jellyfin", "summary": "Restarted 3 times since midnight" }] }
```

- `up` is the number of running containers and `total` all of them; `up` can't be greater than `total`.
- `issues` lists every container with a problem, worst first, each with a one-line `summary`.
- Never copy secrets, tokens or passwords from the logs into a summary.

### Raise it in Important

Only **serious** problems go to Important. Plain log warnings stay on the banner. Load the `daily-intake-alerts` skill for the alert rules.

| Problem | Severity |
|---|---|
| The container is down (exited, or not running when it should be) | `critical` |
| It keeps restarting (crash loop) | `critical` |
| It can't reach something it needs, such as its database, a mount or the network | `warning` |

`PUT /api/hermes/alerts/container%3Ajellyfin`

```json
{ "source": "containers", "title": "jellyfin keeps restarting", "detail": "7 restarts since 02:00; exits with 'database is locked'.", "severity": "critical" }
```

- The key is `container:<container name>`. `title` says what is wrong in a few words, and `detail` gives one line of evidence from the logs.
- Leave `url` out, unless the user gave you a link for it.
- Resolve every open `container:` alert whose container is fine in this scan: `POST /api/hermes/alerts/<key>/resolve`.

## Both snapshots

- Unknown fields are rejected at every level.
- Each new `capturedAt` stores a new snapshot (`201`), and the page shows the newest one. If you send the same `capturedAt` again with the same payload, nothing changes (`200`). If you send it with a different payload, that capture is replaced.
