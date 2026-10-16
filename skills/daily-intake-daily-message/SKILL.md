---
name: daily-intake-daily-message
description: Write the short morning message shown on the Daily Intake dashboard's banner.
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
    tags: [daily-intake, dashboard]
---

# Daily Intake: daily message

Load the `daily-intake` skill first. It has the connection, reading state, keys and status codes. This skill only adds the daily message.

## Writing it

`PUT /api/hermes/daily-message/<YYYY-MM-DD>`, with the local date in the dashboard's `timeZone`:

```json
{ "text": "Morning! Two work blocks today; jellyfin is flapping again." }
```

The text is at most 500 characters. Sending the same text again is a no-op.
