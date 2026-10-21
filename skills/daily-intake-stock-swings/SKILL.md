---
name: daily-intake-stock-swings
description: Watch the day's moves of the stocks on the user's Daily Intake watchlist and raise the unusual ones in the Important panel, with the reason from the news. Use from the scheduled stock-swings job on US market days.
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
    tags: [daily-intake, dashboard, stocks, alerts]
---

# Daily Intake: stock swings

Load the `daily-intake` skill first. It has the connection, reading state, keys and status codes. Load `daily-intake-alerts` too, for the alert rules. This skill only raises big moves on the watchlist in Important. You also need web search, to read the day's news.

The dashboard fetches the quotes itself every 5 minutes. You read them from the state; you never fetch prices or change the watchlist in this job.

## When it runs

Only on US market days, Monday to Friday. These are the times in US Eastern time (the market is open 09:30–16:00):

| Eastern | What it covers |
|---|---|
| 10:00, 10:30, 11:00, 11:30, 12:00, 12:30 | Every half hour through the first three hours |
| 14:00 | Midday |
| 16:15 | The close |

Convert them to the zone your scheduler uses. In the dashboard's zone `America/Denver`, for example, they are 08:00 to 10:30, 12:00 and 14:15.

## Each run

1. `GET /api/hermes/state`. Take `date`, `timeZone`, `stocks` (`{ asOf, rows }`, where each row has `symbol`, `price`, `currency`, `dayChangePct` and `sixMonthChangePct`) and the open `alerts` whose key starts with `stocks:`.
2. **Market closed?** If today is not a US market day (a weekend or a market holiday), change nothing. On those days the quotes still show the last trading day's move.
3. **Stale quotes?** If `stocks` is `null`, or `asOf` is more than 30 minutes old, change nothing and say in one line that the quotes are stale.
4. **New day:** resolve every open `stocks:` alert whose `openedAt` is before today in `timeZone`. Yesterday's moves are over.
5. **Judge each row** whose `dayChangePct` is at least **+3** or at most **−3**:
   - Search the news for that ticker today.
   - Decide whether the move is **unusual for that stock**. A volatile name, such as TSLA or a small chip stock, often moves 3–5% on no news. A utility or an oil major rarely does. Raise it when the move is outside that stock's normal range, or when the news shows a real event: earnings, guidance, a downgrade, a lawsuit, a deal, a regulation.
6. **Raise or update** each unusual move (below). On later runs the same day, update its `title` and `detail` when the move changes.
7. **Resolve** each open `stocks:` alert from today whose move is no longer unusual (for example, it fell back under 3%).

## The alert

`PUT /api/hermes/alerts/stocks%3ANVDA`

```json
{ "source": "stocks", "title": "NVDA −6.2% today", "detail": "Fell after new US export limits on AI chips to China; its biggest drop since April.",
  "url": "https://www.reuters.com/technology/...", "severity": "warning" }
```

- The key is `stocks:<SYMBOL>`, using the symbol as it appears in `rows`.
- `title` is the symbol and the day's move, rounded to one decimal place, with a `+` or `−` sign.
- `detail` is one or two plain sentences on why it moved and why it matters. It is at most 500 characters.
- `url` is the news article that best explains the move. Leave it out if you found none.
- Always use `warning`.

## When it runs on a schedule

End your reply with `[SILENT]` when the run succeeded, so nothing is delivered to the user. If the dashboard failed, or the quotes were stale, say what happened in one line instead.
