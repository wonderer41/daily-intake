---
name: daily-intake
description: Base skill for the user's Daily Intake dashboard. It covers how to reach the dashboard's HTTP API, read its state, address cards, items and sprints by key or id, handle versions and 409 conflicts, and read the status codes. Load it before any daily-intake-* skill. On its own, use it to answer what is on the user's dashboard.
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

# Daily Intake dashboard

This is the base for the `daily-intake-*` skills. Each of them starts with "load `daily-intake` first" and only adds its own job. The rules here apply to all of them.

| Skill | Job |
|---|---|
| `daily-intake-sprints` | Sprints, Working-on cards, checklist items and deadlines, and turning a note into a card |
| `daily-intake-alerts` | Entries in the Important panel: problems and escalations |
| `daily-intake-notes` | Your notes in the Notes panel |
| `daily-intake-gmail` | The Gmail banner snapshot, and mail left unanswered in Important |
| `daily-intake-scan` | The container-scan banner snapshot, and serious container problems in Important |
| `daily-intake-stock-swings` | Unusual moves on watchlist stocks in Important |
| `daily-intake-watchlist` | The stocks watchlist |
| `daily-intake-daily-message` | The daily message |
| `daily-intake-weekly-checkin` | The weekly check-in |
| `daily-intake-scheduling` | Booking work blocks from chat, linked to items and alerts, and calendar changes the timeline should pick up |

The dashboard does some jobs itself, with no skill: it reviews pushes to the repos on cards (it sends you the commits and reads your answer), it raises Seerr requests that waited too long in Important, and it keeps the orphans list (it reads the orphan folder every Wednesday and raises orphans left there in Important). Never raise or resolve `orphans:` alerts yourself.

## Connection

- Base URL: `$DAILY_INTAKE_URL`. Token: `$DAILY_INTAKE_TOKEN`. Both are in your env file.
- Never print the token, and never put it in a message, a file or a log.
- Every request uses this template. Leave out `-d` when there is no body. Don't use `curl -f`, because it hides the error body, and you need that body to recover.

```bash
curl -sS -X PUT "$DAILY_INTAKE_URL/api/hermes/<path>" \
  -H "Authorization: Bearer $DAILY_INTAKE_TOKEN" -H "Content-Type: application/json" \
  -d '<json>' -w '\nHTTP %{http_code}\n'
```

The `daily-intake-*` skills show each request as `METHOD path` plus a body.

## Read state first

`GET /api/hermes/state` returns:

- `date` and `timeZone`. `date` is today in the dashboard's time zone; use that zone for every date you send.
- `activeSprint` and `sprints`, which hold the planned and active sprints. Each sprint has `id`, `key`, `name`, `startsOn`, `endsOn`, `status`, `daysLeft` and `version`.
- `cards`, which holds every card that is not archived, in page order. Each card has `id`, `key`, `title`, `dueOn`, `status`, `sprintId`, `sprintKey`, `repoFullName`, `milestoneTitle`, `hermesSuggestion`, `progress {done,total}`, `current {itemId,itemKey,title,label}`, `version` and `items[]`.
  - Each item has `id`, `key`, `title`, `issueNumber`, `dueOn`, `done`, `doneBy`, `isCurrent`, `position`, `version` and `progress[]`.
  - `doneBy` says who checked a done item: `user` (on the page), `hermes` (you), `push` (the user confirmed a push update), or `null` when it isn't known.
  - An item's `progress[]` lists its push updates that are still pending, as `{kind, commitSha}`. The dashboard writes them after it reviews a push.
- `alerts`, which holds the open alerts in the Important panel: `id`, `dedupeKey`, `source`, `title`, `detail`, `url`, `severity`, `openedAt`, and `dismissedAt` (set when the user dismissed it).
- `notes`, which holds every note in the Notes panel, newest first, zero counts included: `id`, `author` (`user` or `hermes`), `key` (`null` on the user's notes), `text`, `detail`, `url`, `count`, `createdAt` and `updatedAt`.
- `dailyMessage` (today's, or `null`), `recentDailyMessages` (the 60 days before today, newest first) and `watchlist` (the tickers in banner order).
- `checkin`, this week's check-in if you wrote one: `weekOf`, `summary`, `updatedAt` and `items` (`key`, `text`, `done`, `itemId`, `itemKey`).
- The newest banner data some jobs build on, each `null` until there is one:
  - `gmail`: the last Gmail snapshot, `{ capturedAt, data }`.
  - `orphans`: the dashboard's last orphans check, `{ capturedAt, data }`, read-only. `data` is `{ total, items }`, and each item has `name` (the raw file or folder name in the orphan folder), `checks` (Wednesday checks that listed it; 0 or 1 means new) and `firstSeenAt`, longest-waiting first. Use it to answer what is stuck in the orphan folder. You can't push it: the dashboard writes it.
  - `stocks`: the latest quotes the dashboard fetched, `{ asOf, rows }`. Each row has `symbol`, `price`, `currency`, `dayChangePct` and `sixMonthChangePct`.

Read the state before every batch of writes. Reuse what is already there. Never create a second card or item for something that already exists, even if it has no key.

## Addressing rows: key or id

Cards, items and sprints can be addressed in two ways in a path, and in a card's `sprintKey`:

- **By key.** This is a stable name you choose. A `PUT` to a key creates the row if it doesn't exist yet and updates it if it does.
- **By id.** Write `id:<uuid>`, using the `id` from the state. This is the only way to reach rows the user created on the page, because those have `key: null`. An id never creates a row: if no row has that id, the API answers `404 NOT_FOUND`.

| Thing | Key format | Example |
|---|---|---|
| Card you create | `hermes:card:<slug>` | `hermes:card:orphan-cleanup` |
| Card for a GitHub milestone | `github:milestone:<owner>/<repo>:<n>` | `github:milestone:example-user/study-sessions:3` |
| Card for a repo | `github:repo:<owner>/<repo>` | `github:repo:example-user/pomanor-mcp` |
| Item you create | `hermes:item:<card-slug>:<slug>` | `hermes:item:orphan-cleanup:review-bdmvs` |
| Item for an issue | `github:issue:<owner>/<repo>#<n>` | `github:issue:example-user/study-sessions#13` |
| Sprint | `hermes:sprint:<slug>` or `hermes:sprint:<start-date>` | `hermes:sprint:2026-10-12`, `hermes:sprint:streaks-v1` |
| Alert | `<source>:<thing>` | `container:jellyfin`, `proxmox:vzdump:vm100` |
| Your note | `<source>:<thing>` | `github:prs-to-review` |
| Any page-created card, item or sprint | `id:<uuid>` | `id:5f0c2b9e-1d2a-4c3b-9f8e-7a6b5c4d3e2f` |
| Any note (delete only) | `id:<uuid>` | `id:9b1d7c4e-2f3a-4e5b-8c6d-0a1b2c3d4e5f` |

Rules for keys:

- Slugs are lowercase: `a-z`, `0-9`, `.`, `_` and `-`, starting with a letter or digit. Pick a slug once and reuse it every time.
- Keys are at most 200 characters.
- URL-encode every key in a path: `:` becomes `%3A`, `/` becomes `%2F` and `#` becomes `%23`. For example, `github:issue:example-user/study-sessions#13` is written as `github%3Aissue%3Aexample-user%2Fstudy-sessions%2313`, and `id:5f0c…` is written as `id%3A5f0c…`.

## Changing rows the user may have edited: versions

The user's edits win. Every card, item and sprint has a `version`.

- **Creating a row** needs no version.
- **Re-sending exactly what is stored** is a no-op that always succeeds. The answer is `200` with `created: false`, and the version doesn't change.
- **Changing an existing row** requires `"version": <the version you read from state>` in the body.
  - If the row changed since you read it, the API answers `409 CONFLICT`. In that case, `GET /api/hermes/state` again, decide whether your change still makes sense, and retry with the new version.
  - The 409 body explains the conflict in `error.details`: `{ reason, fields, currentVersion, data }`. `reason` is `version_required`, `stale_version` or `done_is_user_owned`, and `data` is the current row.
- **`"force": true`** overrides the version check. Send it only when the user explicitly asked you to change that thing.
- **`done` belongs to the user.** Changing `done` in either direction (checking or unchecking) on an existing item needs `force: true`, even with the right version. Never send it unless the user asked.
- Setting `isCurrent: true` on one item clears it on the other items of the same card, which bumps their versions. Re-read the state before you write those items.

Body conventions:

- If you leave a field out, the stored value stays as it is.
- If you send `null` (or `""` for text), the field is cleared.
- Unknown fields are rejected with `400`.
- The required fields have to be sent on every `PUT`, even when nothing else changes: `title` for cards and items, and `name`, `startsOn` and `endsOn` for sprints. Send the current value if you don't mean to change it.

## Status codes

| Code | Meaning | What you do |
|---|---|---|
| `201` | The row was created (`created: true`) | Done. |
| `200` | The row was updated, or nothing changed (`created: false`) | Done. |
| `400 VALIDATION_ERROR` | Bad body or key; `error.details.field` names the field | Fix that field. Don't retry unchanged. |
| `401 UNAUTHORIZED` | Wrong or missing token | Stop and tell the user. |
| `404 NOT_FOUND` | The id doesn't exist, the card or sprint is missing, or the item is not on that card | Re-read the state, or create the parent first. |
| `409 CONFLICT` | Stale or missing `version`, or `done` sent without `force` | Re-read the state and retry with the new version. Use `force` only if the user asked. |
| `429 RATE_LIMITED` | More than 60 requests per minute | Wait for the number of seconds in the `Retry-After` header, then continue. |
| `500` / `502` | A dashboard error, or an upstream error from Google or the stock APIs | Retry once later. If it fails again, tell the user. |

Every error body looks like this:

```json
{ "error": { "code": "...", "message": "...", "details": {} } }
```
