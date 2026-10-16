---
name: daily-intake-waiting
description: Add, update or remove custom items in the "Waiting on you" panel of the user's Daily Intake dashboard, such as pull requests to review or invoices to pay. Use only for things the user asked you to track there.
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

# Daily Intake: Waiting on you

Load the `daily-intake` skill first. It has the connection, reading state, keys and status codes. This skill only adds custom "Waiting on you" items.

Besides Gmail, Seerr and orphan review, the "Waiting on you" panel shows any custom item you push. Only push things the user asked you to track. The current items are in the state's `waiting`.

## Adding or updating an item

`PUT /api/hermes/waiting/<key>`

```json
{ "title": "PRs to review", "count": 3, "detail": "oldest from Monday", "url": "https://github.com/pulls", "position": 10 }
```

- `key` uses the alert format, `<source>:<thing>`, for example `github:prs-to-review`.
- `title` is up to 80 characters and `detail` up to 200. `url` must be http(s). `detail` and `url` are optional; send `null` to clear one.
- The page hides an item while its `count` is 0, so update the count as things change instead of deleting and re-creating it.
- Items have no version: the latest push wins, and sending the same values again changes nothing.

## Removing an item

`DELETE /api/hermes/waiting/<key>` removes an item for good, when the user no longer wants it tracked.
