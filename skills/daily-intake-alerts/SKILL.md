---
name: daily-intake-alerts
description: Open, update and resolve entries in the Important panel of the user's Daily Intake dashboard. Use when a check you run finds a problem (a failing container, a backup, a server), when something elsewhere has waited too long or matters enough that the user must act, when the user asks you to flag something, or when a problem you flagged goes away.
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

# Daily Intake: alerts (Important panel)

Load the `daily-intake` skill first. It has the connection, reading state, keys and status codes. This skill only adds alerts.

Important lists what the user has to attend to or act on, a bit like notifications. There are two kinds of alerts:

- **Problems**, such as a failing container, a failed backup or a full disk.
- **Escalations**: something that lives elsewhere and now needs the user, because it waited too long or matters. Examples are a mail left unanswered for days or a big move on a stock they follow. The job skills (`daily-intake-gmail`, `daily-intake-stock-swings`) say when to raise theirs. The dashboard raises its own escalations (Seerr requests waiting too long, orphans left in the orphan folder); never raise or resolve those.

Small things to remember go to Notes instead (the `daily-intake-notes` skill).

On the page, critical alerts come first and the rest are grouped by `source`. Each alert shows its link, a "Block time" button that books time to deal with it, and a Dismiss button.

## Opening or updating an alert

`PUT /api/hermes/alerts/<dedupeKey>`

```json
{ "source": "proxmox", "title": "local-lvm is 92% full", "detail": "Up from 80% last week",
  "url": "https://proxmox.example.com:8006", "severity": "warning" }
```

- `dedupeKey` uses the alert key format, `<source>:<thing>`, for example `container:jellyfin` or `proxmox:vzdump:vm100`. Use the same key every time for the same problem.
- `source` names where the alert comes from, in lowercase, such as `proxmox`, `gmail`, `stocks` or `containers`. It is at most 100 characters, and the page groups alerts by it.
- `title` is at most 200 characters. `detail` is at most 500 characters.
- `source` and `title` are required on every PUT. Send the current values if you don't mean to change them.
- `url` is where the user acts on it, shown as ↗ on the page. It must be http(s).
- `detail` and `url` are optional. Leave one out to keep it, or send `null` to clear it.
- `severity` is `warning` (the default) or `critical`. Escalations are always `warning`.
- `meta` is an optional object of at most 4 KB, merged into what is stored.
- Alerts have no version: the latest push wins, and sending the same values again changes nothing (`200`, `created: false`).
- Re-sending a PUT for an alert that was resolved **reopens** it, because the problem came back.

## When the user dismisses an alert

The user can dismiss an open alert on the page. The state's `alerts` show it with `dismissedAt` set.

- A dismissed alert stays hidden for as long as it stays open, even while you keep sending it. Keep updating it as usual.
- It shows again only when the problem went away and came back (you resolved it, and a later PUT reopens it), or when it got worse (its severity goes from `warning` to `critical`).
- Never resolve and reopen an alert, or raise its severity, just to show it to the user again.

## Resolving an alert

`POST /api/hermes/alerts/<dedupeKey>/resolve` takes no body. Send it when the problem is gone or the user has dealt with it. Resolving twice changes nothing, and a key with no alert answers `404`.

## Alerts the dashboard owns

The dashboard opens and resolves these alerts itself. Never send or resolve them:

- `seerr:request:<id>`: a Seerr request that has waited too many days.
- `orphans:entry:<id>`: a file or folder still in the orphan folder after two Wednesday checks in a row.
- `orphans:mount`: the Wednesday check found the orphan folder not mounted or unreadable.
- `github:push-review:<owner>/<repo>`: push reviews of that repo keep failing.
