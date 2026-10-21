---
name: daily-intake-notes
description: Add, update or remove your notes in the Notes panel of the user's Daily Intake dashboard, such as pull requests to review or invoices to pay, and read the user's own notes. Use only for things the user asked you to keep there.
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

# Daily Intake: notes

Load the `daily-intake` skill first. It has the connection, reading state, keys and status codes. This skill only adds the Notes panel.

Notes are small things to remember that aren't urgent, like an idea or a count of pull requests to review. Anything the user has to attend to or act on goes to Important instead (the `daily-intake-alerts` skill).

The state's `notes` lists every note, newest first, zero counts included. There are two kinds:

- **The user's notes** (`author: "user"`, `key: null`). The user writes them on the page. Read them, but never change or delete them. The one exception is a note the user turns into a card with you (see `daily-intake-sprints`).
- **Your notes** (`author: "hermes"`), each with a key. Only keep notes the user asked you to track there.

## Adding or updating a note

`PUT /api/hermes/notes/<key>`

```json
{ "text": "PRs to review", "count": 3, "detail": "oldest from Monday", "url": "https://github.com/pulls" }
```

- `key` uses the alert format, `<source>:<thing>`, for example `github:prs-to-review`.
- `text` is required and at most 200 characters. `detail` is at most 200 characters, `url` must be http(s), and `count` is a whole number from 0 to 1,000,000.
  - `detail`, `url` and `count` are optional. Leave one out to keep it, or send `null` to clear it.
- The page hides a note while its `count` is 0, so update the count as things change instead of deleting the note and creating it again.
- The page orders notes by when they were created, so updating a note doesn't move it.
- Notes have no version: the latest push wins. A new note answers `201`; sending the same values again changes nothing (`200`, `created: false`).

## Removing a note

`DELETE /api/hermes/notes/<key>` removes your note for good, when the user no longer wants it tracked. It answers `404` when no note has that key.

The user can also delete any note on the page. Sending its key again creates it anew.
