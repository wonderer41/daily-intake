# Daily Intake skills

These skills teach an AI agent to work with a [Daily Intake](../README.md) dashboard. Each folder holds one
`SKILL.md` in the [Agent Skills](https://agentskills.io) format, so the same files work in Hermes,
Claude Code and other agents that read that format.

**If you are an agent asked to install these:** install every skill below from this repository
(`wonderer41/daily-intake`), using the exact identifiers here. Don't search the web for them. Then do
"Set up" and, if the user wants them, the scheduled jobs.

## The skills

`daily-intake` is the base: every other skill starts by loading it. Install all of them.

| Skill | What it lets the agent do | When it's used |
|---|---|---|
| [`daily-intake`](daily-intake/SKILL.md) | Connection, reading the page's state, keys and ids, versions and errors | Loaded by every other skill |
| [`daily-intake-sprints`](daily-intake-sprints/SKILL.md) | Plan sprints with the user (plan first, create on yes), cards, checklist items, deadlines, a note into a card | Chat, and a daily sprint-end job |
| [`daily-intake-alerts`](daily-intake-alerts/SKILL.md) | Open, update and resolve entries in Important | Loaded by the jobs that raise entries |
| [`daily-intake-notes`](daily-intake-notes/SKILL.md) | Keep the agent's own notes in Notes | Chat and any job |
| [`daily-intake-gmail`](daily-intake-gmail/SKILL.md) | The Gmail slide, and mail left unanswered in Important | Scheduled |
| [`daily-intake-scan`](daily-intake-scan/SKILL.md) | The daily container-scan result, and serious container problems in Important | Your existing daily scan job |
| [`daily-intake-stock-swings`](daily-intake-stock-swings/SKILL.md) | Unusual moves on watchlist stocks in Important, with the reason | Scheduled, market days |
| [`daily-intake-watchlist`](daily-intake-watchlist/SKILL.md) | Show or change the stock watchlist | Chat |
| [`daily-intake-daily-message`](daily-intake-daily-message/SKILL.md) | Write the daily message | Scheduled, and chat |
| [`daily-intake-weekly-checkin`](daily-intake-weekly-checkin/SKILL.md) | Write the weekly check-in and update it | Scheduled, and chat |
| [`daily-intake-scheduling`](daily-intake-scheduling/SKILL.md) | Book work blocks from chat, linked to their item or alert; tell the dashboard the calendar changed | Chat |

The dashboard does some jobs itself, with no skill: it reviews pushes to the repos on cards, raises
Seerr requests that waited too long, and keeps the orphan-folder list.

## Install

### Hermes, from GitHub

Hermes finds these through the [skills.sh](https://skills.sh) registry, which indexes this repo. Preview
one first if you like: `hermes skills inspect wonderer41/daily-intake/skills/daily-intake`.

```bash
for skill in daily-intake daily-intake-sprints daily-intake-alerts daily-intake-notes daily-intake-gmail \
  daily-intake-scan daily-intake-stock-swings daily-intake-watchlist daily-intake-daily-message \
  daily-intake-weekly-checkin daily-intake-scheduling; do
  hermes skills install "wonderer41/daily-intake/skills/$skill" --yes
done
```

- In Docker, run each command through the container: `docker exec <hermes container> hermes skills install …`.
- To update after the repo changes: `hermes skills check`, then `hermes skills update`.
- If you copied these folders into the skills folder by hand before, delete those copies first, so the
  installed versions are the only ones.
- If Hermes's scanner blocks a skill (they run `curl` with a token from your env file), read it with
  `hermes skills inspect`, then install it with `--force` if you're satisfied.

### Any agent, by hand

Copy each folder into the agent's skills folder: `~/.hermes/skills/` for Hermes (`$HERMES_HOME/skills`
when it runs in Docker), `~/.claude/skills/` for Claude Code. To update, copy them again.

## Set up

1. Put two values in the agent's env file (for Hermes, `$HERMES_HOME/.env`, then restart it):
   - `DAILY_INTAKE_URL`: where the agent reaches the dashboard, e.g. `http://127.0.0.1:4849` on the same host.
   - `DAILY_INTAKE_TOKEN`: the same value as `HERMES_DASHBOARD_TOKEN` in the dashboard's env file.
2. Check it: `GET $DAILY_INTAKE_URL/api/hermes/state` with `Authorization: Bearer $DAILY_INTAKE_TOKEN`
   answers `200`. A `401` means the two tokens differ.

The agent has to reach the dashboard on your network; an agent that runs in the cloud usually can't.

## Scheduled jobs

Times are in the dashboard's time zone (`DASHBOARD_TIME_ZONE`; the agent's scheduler must run in the
same zone, e.g. `TZ` on the Hermes container). Every scheduled skill ends its reply with `[SILENT]` when
the run worked, so only failures are delivered: point them at a channel you watch.

| Job | Skills | When |
|---|---|---|
| Daily message | `daily-intake`, `daily-intake-daily-message` | Every day 06:50 |
| Gmail | `daily-intake`, `daily-intake-alerts`, `daily-intake-gmail` | Every day 07:00, 08:30, 10:00, 11:30, 13:00, 14:30, 16:00, 17:30 |
| Stock swings | `daily-intake`, `daily-intake-alerts`, `daily-intake-stock-swings` | Mon–Fri, US Eastern 10:00–12:30 every half hour, 14:00, 16:15 |
| Weekly check-in | `daily-intake`, `daily-intake-weekly-checkin` | Wednesday 07:30 (write), Friday 15:00 (update) |
| Sprint end | `daily-intake`, `daily-intake-sprints` | Every day 10:45; silent unless a sprint ends that day, then it messages the user |
| Container scan | `daily-intake`, `daily-intake-alerts`, `daily-intake-scan` | Add these to your existing daily container health scan |

With Hermes, for a dashboard in `America/Denver` (Eastern times converted). Replace `<failures>` with the
channel failures go to and `<chat>` with the one where you talk to Hermes (e.g. `discord:<channel id>`):

```bash
C="hermes cron"
D="--skill daily-intake"
A="--skill daily-intake-alerts"
$C create --name "Daily Intake: daily message" --deliver <failures> $D --skill daily-intake-daily-message \
  "50 6 * * *" "Write today's daily message on the Daily Intake dashboard."
$C create --name "Daily Intake: Gmail (on the hour)" --deliver <failures> $D $A --skill daily-intake-gmail \
  "0 7,10,13,16 * * *" "Update the Gmail slide on the Daily Intake dashboard."
$C create --name "Daily Intake: Gmail (half past)" --deliver <failures> $D $A --skill daily-intake-gmail \
  "30 8,11,14,17 * * *" "Update the Gmail slide on the Daily Intake dashboard."
$C create --name "Daily Intake: stock swings (morning)" --deliver <failures> $D $A --skill daily-intake-stock-swings \
  "0,30 8-10 * * 1-5" "Check the watchlist for unusual moves today."
$C create --name "Daily Intake: stock swings (midday)" --deliver <failures> $D $A --skill daily-intake-stock-swings \
  "0 12 * * 1-5" "Check the watchlist for unusual moves today."
$C create --name "Daily Intake: stock swings (close)" --deliver <failures> $D $A --skill daily-intake-stock-swings \
  "15 14 * * 1-5" "Check the watchlist for unusual moves today."
$C create --name "Daily Intake: check-in (write)" --deliver <failures> $D --skill daily-intake-weekly-checkin \
  "30 7 * * 3" "Write this week's check-in on the Daily Intake dashboard."
$C create --name "Daily Intake: check-in (Friday update)" --deliver <failures> $D --skill daily-intake-weekly-checkin \
  "0 15 * * 5" "Update this week's check-in with progress and weekend suggestions."
$C create --name "Daily Intake: sprint end" --deliver <chat> --failure-deliver <failures> $D --skill daily-intake-sprints \
  "45 10 * * *" "If today is the active sprint's last day, send the wrap-up and propose the next sprint; otherwise stay silent."
$C edit <your scan job id> --add-skill daily-intake --add-skill daily-intake-alerts --add-skill daily-intake-scan
```
