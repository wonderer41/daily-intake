---
name: daily-intake-scheduling
description: Book work blocks on the user's Google Calendar when they ask in chat, linked to the matching Daily Intake card item or alert so the timeline shows them, and tell the dashboard to re-read the calendar after you book, move or delete an event. Use when the user asks you to block, book, schedule or move time for something.
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

# Daily Intake: booking time and calendar changes

Load the `daily-intake` skill first. It has the connection, reading state, keys and status codes. This skill only adds booking work blocks from chat and how the dashboard learns about calendar changes.

The dashboard's "Ask Hermes" bubble books blocks through its own request to you, with these same rules spelled out. This section is for when the user asks in chat.

## Booking a block from chat

When the user asks you to block, book or move time for something ("block 2h tomorrow for the BDMV review"):

1. `GET /api/hermes/state`. Find what the time is for: a checklist item on one of the `cards`, or one of the open `alerts`. If more than one could match, ask which. If nothing matches, book a plain event as they asked, without the marker and property below, and skip to step 5.
2. Build the event, in the dashboard's time zone (`timeZone` in the state), on the user's primary calendar unless they name another:
   - Title: `Work block · <card title> <item title>` for an item (with ` #<issueNumber>` after the card title when the item has one), or `Fix · <alert title>` for an alert. At most 300 characters.
   - Description: the marker on its own line, `[daily-intake:item:<item id>]` or `[daily-intake:alert:<alert id>]`, using the `id` from the state (not the key).
   - Private extended property: `dailyIntakeItemId=<item id>` or `dailyIntakeAlertId=<alert id>`.
3. Look for an existing event with the same marker or property. That is an earlier block for the same thing: move it to the new time instead of creating a second one, unless the user asks for another block.
4. Before booking, read the calendar for that window. If another event overlaps it (other than the earlier block from step 3), don't book. Tell the user what is in the way and offer the nearest free time.
5. After booking or moving, tell the dashboard (below), then tell the user the time you booked.

## After you book or move a calendar event

`POST /api/hermes/calendar/changed`, with no body or with `{ "calendarId": "<id>" }`, makes the dashboard sync the calendar so the timeline updates right away. If Google isn't set up on the dashboard or fails, the answer is `502`.
