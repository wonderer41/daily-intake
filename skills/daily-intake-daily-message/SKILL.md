---
name: daily-intake-daily-message
description: Write the daily message on the Daily Intake dashboard's banner - by default a word of the day with its meaning and a fact, following the guidelines the user gave you. Use from the scheduled daily-message job (06:50 every day), when the user asks for a new one, or when the user changes their guidelines for it.
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

Load the `daily-intake` skill first. It has the connection, reading state, keys and status codes. This skill only adds the daily message: the first slide on the banner, one short text signed "— Hermes".

## What to write

**Follow the user's guidelines.** The user tells you in chat what the daily message should be, such as topics, languages, tone, or the kind of facts. Keep those guidelines in your memory, and update them whenever the user changes them. They are not in this skill, and they win over the default below.

**The default**, when the user has given no guidelines: one **word of the day**, a short meaning, and one **fact**. Pick a fresh word and a fresh fact every day; don't take them from a fixed list.

```text
Petrichor — the earthy smell after rain. Fact: octopuses have three hearts.
```

- Write plain text. The slide shows it as is, in large italic type, so keep it to about 200 characters (500 at most).
- Check that the fact is true. Leave out anything you aren't sure about.
- **Don't repeat yourself.** The state's `recentDailyMessages` holds the messages of the last 60 days. Don't reuse a word or a fact from them.

## When it runs

Every day at **06:50** in the dashboard's time zone (`timeZone` in the state), weekends included.

## Each run

1. `GET /api/hermes/state`. Take `date`, `dailyMessage` (today's, if one exists already) and `recentDailyMessages`.
2. If today already has a message, leave it, unless the user asked you for a new one.
3. Write the message, following the guidelines and the rules above.
4. `PUT /api/hermes/daily-message/<date>`, with today's `date` from the state:

```json
{ "text": "Petrichor — the earthy smell after rain. Fact: octopuses have three hearts." }
```

A new message answers `201`. Sending the same text again is a no-op (`200`), and a different text replaces today's message.

## When it runs on a schedule

When the push succeeded, reply with exactly `✅ Daily message pushed` and nothing else, so the user only gets a short note that the job ran. If the dashboard failed, say what failed in one line instead.
