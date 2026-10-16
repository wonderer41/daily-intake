---
name: daily-intake-push-review
description: After a push to one of the user's GitHub repos, compare the commits with that repo's Working-on card on the Daily Intake dashboard and leave a progress note on each checklist item the push moved forward or seems to finish.
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
    tags: [daily-intake, dashboard, github]
---

# Daily Intake: push-progress notes

Load the `daily-intake` skill first. It has the connection, reading state, keys, versions and status codes. This skill only adds progress notes on checklist items after a push.

## Which pushes

Only pushes to a repo that has a card count: the card's `repoFullName` equals the push's repo. Skip repos without a card.

## Writing a note

Read the push's commits and diff. Then compare them with that card's open items (`done: false`).

For each item the push clearly touches, write **one** note. Use the push's head commit SHA (the full 40 characters):

`PUT /api/hermes/cards/<card>/items/<item>/progress/<sha>`

```json
{ "repoFullName": "example-user/study-sessions", "kind": "partial",
  "note": "Added the streak model and migration; the UI is still missing.", "pushedAt": "2026-10-14T19:05:00Z" }
```

- Use `"kind": "looks_done"` when the push appears to finish everything the item asks for, for example when the issue's acceptance criteria are met or a commit says it closes the issue. The page then asks the user: "looks done from push X — confirm?".
- Use `"kind": "partial"` when the push moves the item forward but leaves work.
- Send nothing when the link is weak.
- `note` is one plain sentence of at most 500 characters saying what the push did for that item.
- `pushedAt` is an ISO time with a zone.

## Rules

- **Never check the item yourself.** Don't send `done` for it. The user confirms `looks_done` notes on the page, and that confirmation checks the item.
- One note per (item, sha). Re-sending the same note is a no-op (`200`, `created: false`).
  - Sending the same sha again with different text updates the note.
  - If the user dismissed the note, sending the same sha with a **different `kind`** shows it to them again. Only do that when you really changed your verdict.
- Before writing, check the item's `progress[]` in the state. Don't send a second note for a push that is already pending there.
- Process each push once, and don't re-scan old pushes.
