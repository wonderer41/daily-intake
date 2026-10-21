---
name: daily-intake-scan
description: Push the daily container health scan's result to the Daily Intake dashboard's banner, and raise serious container problems in Important. Use from the daily container health scan.
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

# Daily Intake: container scan

Load the `daily-intake` skill first. It has the connection, reading state, keys and status codes. This skill only adds the scan snapshot on the banner and the Important entries for serious container problems.

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
- Unknown fields are rejected at every level.
- Each new `capturedAt` stores a new snapshot (`201`), and the page shows the newest one. If you send the same `capturedAt` again with the same payload, nothing changes (`200`). If you send it with a different payload, that capture is replaced.

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
