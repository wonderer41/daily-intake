---
name: daily-intake-calendars
description: Show or change which of the user's Google calendars appear on the Daily Intake dashboard's timeline. Use when the user asks which calendars the dashboard shows, to add or remove a calendar from it, or why events from one of their calendars are missing on the timeline.
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

# Daily Intake: which calendars the timeline shows

Load the `daily-intake` skill first. It has the connection, reading state, keys and status codes. This skill only adds the list of Google calendars the timeline shows.

The dashboard reads Google Calendar itself, every 2 minutes. It always shows the **booking calendar**, where blocks booked from the page go (usually the user's main calendar). Every other calendar shows only after the user asks for it. A calendar the user creates later stays off the timeline until they ask you to add it.

## Reading the list

`GET /api/hermes/calendar/sources` returns every calendar on the user's Google account:

```json
{ "data": { "calendars": [
  { "id": "me@gmail.com", "name": "me@gmail.com", "primary": true, "shown": true, "locked": true, "onAccount": true, "lastSyncAt": "2026-11-11T22:05:48.279Z", "syncError": null },
  { "id": "abc123@group.calendar.google.com", "name": "Important", "primary": false, "shown": false, "locked": false, "onAccount": true, "lastSyncAt": null, "syncError": null }
] } }
```

- `shown`: on the timeline now.
- `locked`: the booking calendar. It is always shown and can't be removed.
- `onAccount: false`: a shown calendar that Google no longer lists (deleted, or access removed). Tell the user and offer to remove it.
- `syncError`: why that calendar's last sync failed. Use it to answer why a calendar's events are missing.

When you tell the user the list, use the `name`s, not the ids.

## Changing it

`PUT /api/hermes/calendar/sources` replaces the whole list of extra calendars. Send it only when the user asks for a change:

```json
{ "calendarIds": ["abc123@group.calendar.google.com", "def456@group.calendar.google.com"] }
```

- To add or remove one calendar, read the list, take the `id` of every calendar with `shown: true` and `locked: false`, add or drop the one the user named, and send that list back.
- Match the user's words to a calendar's `name`. If more than one could match, or none does, ask which one, and show the names.
- Use the `id` exactly as the list gives it. An id that isn't on the account is a `400` with `error.details.unknown` listing it.
- The booking calendar is always kept: leaving it out is fine, and sending it changes nothing. `[]` shows only the booking calendar.
- At most 50 ids.
- The response is `{ "data": { "calendars" }, "created": false, "changed", "synced", "syncError?" }`, with the same `calendars` as the GET.
  - A removed calendar's events leave the timeline right away.
  - When calendars were added, the dashboard syncs them before answering, so their events are on the timeline when you reply. This can take a few seconds.
  - `synced: false` together with a `syncError` means that sync failed. The calendar is saved anyway, and the dashboard retries every 2 minutes. Tell the user the `syncError` text.
  - `502` means Google isn't set up on the dashboard, or Google couldn't be reached to read the list. Nothing was changed.

## Booking on a calendar that isn't shown

If the user asks you to book time on a calendar with `shown: false` (see `daily-intake-scheduling`), the block won't appear on the timeline. Say so, and ask whether to add that calendar too.
