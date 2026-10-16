---
name: daily-intake-watchlist
description: Show or change the stock tickers on the Daily Intake dashboard's banner. Use when the user asks which stocks are on their dashboard, or to add, remove or reorder tickers.
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
    tags: [daily-intake, dashboard, stocks]
---

# Daily Intake: stocks watchlist

Load the `daily-intake` skill first. It has the connection, reading state, keys and status codes. This skill only adds the stocks watchlist.

The dashboard fills the prices itself from Finnhub and Tiingo. Don't push `stocks` banner snapshots; change the watchlist instead.

## Reading it

`GET /api/hermes/watchlist` returns `{ "data": { "symbols": [...] } }`.

## Changing it

`PUT /api/hermes/watchlist` replaces the whole list. Send it only when the user asks for a change:

```json
{ "symbols": ["NVDA", "AMD", "MU", "TSLA", "AMZN", "XOM", "CVX", "COP", "CEG", "VST", "NEE", "TSM"] }
```

- The list holds 1 to 50 tickers. The order you send is the order on the banner.
- Tickers are uppercased and duplicates are dropped.
- To add or remove one symbol, read the list, edit it, and send the whole list back.
- The response is `{ "data": { "symbols" }, "changed", "synced", "syncError?" }`.
  - When the list changed, the dashboard refreshes the stock quotes before answering. This can take up to about 30 seconds.
  - `synced: false` together with a `syncError` means the banner will catch up on its next 5-minute refresh. Tell the user the `syncError` text if they are waiting for the banner.
