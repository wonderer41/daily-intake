---
name: daily-intake-scheduling
description: Tell the Daily Intake dashboard to re-read the user's Google Calendar after you book, move or delete an event, so its timeline updates right away.
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
    tags: [daily-intake, dashboard, calendar]
---

# Daily Intake: calendar changes

Load the `daily-intake` skill first. It has the connection, reading state, keys and status codes. This skill only adds how the dashboard learns about calendar changes.

## After you book or move a calendar event

`POST /api/hermes/calendar/changed`, with no body or with `{ "calendarId": "<id>" }`, makes the dashboard sync the calendar so the timeline updates right away. If Google isn't set up on the dashboard or fails, the answer is `502`.
