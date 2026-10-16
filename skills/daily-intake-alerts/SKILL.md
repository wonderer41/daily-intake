---
name: daily-intake-alerts
description: Open and resolve alerts in the Broken panel of the user's Daily Intake dashboard. Use when a check you run finds a problem (a failing container, a backup, a server), when the user asks you to flag something, or when a problem you flagged goes away.
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
    tags: [daily-intake, dashboard, alerts]
---

# Daily Intake: alerts (Broken panel)

Load the `daily-intake` skill first. It has the connection, reading state, keys and status codes. This skill only adds alerts.

## Opening or updating an alert

`PUT /api/hermes/alerts/<dedupeKey>`

```json
{ "source": "scan", "title": "jellyfin restarting", "detail": "3 restarts since 06:00", "severity": "warning" }
```

- `dedupeKey` uses the alert key format, `<source>:<thing>`, for example `container:jellyfin` or `proxmox:vzdump:vm100`. Use the same key every time for the same problem.
- `severity` is `warning` or `critical`. Alerts have no version, so the latest push wins.
- Re-sending a PUT for an alert that was resolved **reopens** it, because the problem came back.

## Resolving an alert

`POST /api/hermes/alerts/<dedupeKey>/resolve` takes no body. Send it when the problem is gone. Resolving twice changes nothing.
