---
name: daily-intake-weekly-checkin
description: Write the weekly check-in on the user's Daily Intake dashboard. On Wednesday, write how the week is going and what to focus on for the rest of it; on Friday, update it with progress and weekend suggestions. Use from the Wednesday and Friday scheduled jobs, or when the user asks for a check-in.
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
    tags: [daily-intake, dashboard, planning]
---

# Daily Intake: weekly check-in

Load the `daily-intake` skill first. It has the connection, reading state, keys and status codes. This skill only adds the weekly check-in.

Write the check-in on **Wednesday** and update it on **Friday**. From when you write it until Sunday night it is the first slide on the banner, and the user checks lines off on the page.

## Writing it

`PUT /api/hermes/checkin/<YYYY-MM-DD>` (any day of the week; it is stored under that week's Monday)

```json
{
  "summary": "You're ahead on study-sessions, but orphan-cleanup hasn't moved since Monday and its review is overdue.",
  "items": [
    { "key": "bdmv-review", "text": "Review the 4 BDMV folders (~1 h, overdue)", "itemRef": "hermes:item:orphan-cleanup:review-bdmvs" },
    { "key": "streak-tracking", "text": "#13 Streak tracking (~3 h, Thursday evening is free)", "itemRef": "github:issue:example-user/study-sessions#13" },
    { "key": "call-isp", "text": "Call the ISP about Monday's outage" }
  ]
}
```

How to build it:

1. `GET /api/hermes/state`: the active sprint (`daysLeft`), every card and item (`done`, `dueOn`), open alerts, and `checkin` if one exists for this week (with what the user already checked).
2. Read the user's calendar for the rest of the week to find free time.
3. `summary`: 1–3 honest sentences in your own voice. Say how the week is going, and name anything overdue first. At most 1000 characters.
4. `items`: up to 5 lines (10 at most), most important first: overdue and due-soon items, then the active sprint's current items, then open alerts. Add a time estimate and a free slot from the calendar when it helps. Each `text` is at most 200 characters.
5. When a line is one of the cards' checklist items, set `itemRef` (its key or `id:<uuid>`). The line then shares that item's check: checking it in either place checks both. Leave `itemRef` out for anything that isn't on a card.
6. `key` is your name for the line within the week (lowercase letters, digits, dashes). Keep the same key for the same thing when you update the check-in.

## Updating it on Friday

Read `checkin` from the state first. Re-send the lines that still matter with the **same keys** (their checks are kept), drop what no longer matters, and add suggestions for the weekend.

- The list you send replaces the old one; lines you leave out are removed.
- Never mark lines done: checks belong to the user.
- Sending the same check-in again changes nothing.
