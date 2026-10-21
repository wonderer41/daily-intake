---
name: daily-intake-sprints
description: Plan and update sprints, Working-on cards and their checklist items, deadlines included, on the user's Daily Intake dashboard. Use when the user describes a sprint or a project, asks you to track something, gives a deadline, or says some work is finished.
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
    tags: [daily-intake, dashboard, sprints]
---

# Daily Intake: sprints, cards and items

Load the `daily-intake` skill first. It has the connection, reading state, keys, versions and status codes. This skill only adds sprints, Working-on cards and their checklist items.

## Sprints

`PUT /api/hermes/sprints/<key or id:uuid>`

```json
{ "name": "Streaks v1", "goal": "Ship streak tracking", "startsOn": "2026-10-12", "endsOn": "2026-10-25" }
```

- Dates are `YYYY-MM-DD`, and `endsOn` must be on or after `startsOn`. `name` is at most 120 characters and `goal` at most 500.
- A new sprint is created as `planned`.
- To start a sprint, send `"status": "active"` with its `version`. Only one sprint can be active, so activating one closes the previously active sprint automatically. Do this only when the user says the sprint starts.
- `"status": "closed"` ends a sprint.
- When the user describes a sprint, create it first. Then create its cards with `sprintKey`, and then the items of each card.

## Cards

`PUT /api/hermes/cards/<key or id:uuid>`

```json
{ "title": "Orphan cleanup", "milestoneTitle": "Manual review pile", "sprintKey": "hermes:sprint:2026-10-12",
  "repoFullName": "example-user/orphan-tools", "hermesSuggestion": "Block 90 min tonight for the BDMVs?", "meta": { "note": "design phase" } }
```

- `title` is at most 160 characters.
- `status` is one of `active`, `paused`, `done` or `archived`.
- `position` is an integer. New cards go to the end of the column.
- `sprintKey` is a sprint key or `id:<uuid>`. Send `null` to unlink the card from its sprint. If the sprint doesn't exist, the answer is `404`.
- `repoFullName` is `owner/repo`. Set it on cards that track a GitHub repo. The dashboard then reviews each push to that repo against the card's open items and shows push updates on them ("looks done" or progress); there is nothing for you to do. Leave it out for plain to-do cards that aren't tied to a repo.
- `dueOn` is the card's deadline as `YYYY-MM-DD` (a local date; overdue once that day is over). Send `null` to clear it. Only set it when the user gave you a deadline.
- `hermesSuggestion` is one short line shown on the collapsed card, such as `Block 90 min tonight for #12?`. Clear it with `null` once the work is booked or the suggestion is stale.
- `meta` is merged shallowly into what is stored: keys you send overwrite, a key set to `null` is removed, and keys you leave out stay. The limit is 4 KB.
  - `meta.note` is shown in the card's meta line. Use it for a short phase or status, such as `"design phase"`.

## Checklist items

`PUT /api/hermes/cards/<card>/items/<key or id:uuid>`

```json
{ "title": "Review the 4 BDMV folders", "isCurrent": true }
```

- `title` is at most 200 characters.
- The other fields are `issueNumber`, `sourceUrl` (http or https), `dueOn`, `isCurrent`, `position`, `done` (see the versions rules in `daily-intake`), `version` and `force`.
- When the user tells you an item is finished, check it: send `"done": true` with its `version` and `"force": true`, because they asked. The page then shows that you checked it (`doneBy: "hermes"` in the state).
- `dueOn` is the item's own deadline (`YYYY-MM-DD`, or `null` to clear). An item without one falls under its card's `dueOn`. The user can also set deadlines on the page, and their edits win.
- `isCurrent` marks the "now" item. If no item is current, the page shows the first unchecked item as "next".
- If you put an existing item under a different card, it moves to that card. That is a change, so it needs the item's `version`.
- The card must exist before you add items to it, or the answer is `404`.

## Archiving

`POST /api/hermes/cards/<key or id:uuid>/archive` takes no body.

- Archive a card when its milestone closes or when the user says the work is done. Archiving needs no version.
- Never delete a card.

## When to create a card

- The user asks you to track something.
- A new GitHub milestone appears in their repos.
- A multi-step homelab job starts.
- The user wants to turn one of their notes into a real project (below).

## Turning a note into a card

The user's notes (the state's `notes` with `author: "user"`) are small things to remember, such as an idea. When the user asks you to work on one as a real project:

1. Plan it with them in chat: the card (title, sprint, repo, deadline) and its checklist items. Create nothing until they agree.
2. Create the card and its items as described above.
3. Delete the note with `DELETE /api/hermes/notes/id%3A<note id>`, using the note's `id` from the state. This is the only time you delete one of the user's notes.
4. Tell them in chat that the note is now the card, and that you removed it from Notes.

Don't rename the user's cards or un-check their items unless they ask you to.
