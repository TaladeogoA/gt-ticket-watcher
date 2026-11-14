# Ticket Watcher

Checks an event's ticket availability on a schedule and sends a push notification
through [ntfy](https://ntfy.sh) when something changes.

## Run locally

Requires Node 20+ and Google Chrome.

```bash
npm install
```

Copy `.env.example` to `.env`, set `NTFY_TOPIC`, then:

```bash
npm start
```

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | Run continuously. |
| `npm run once` | One check, then exit. |
| `npm run test-notify` | Send a test notification. |
| `npm run simulate-release` | Send a sample alert marked `[TEST]`. |
| `npm run selftest` | Print what simulated changes would alert. Sends nothing. |

## Run on GitHub Actions

`.github/workflows/watch.yml` runs the watcher continuously. Set the repository
secret `NTFY_TOPIC`, then start it:

```bash
gh workflow run watch.yml
```

Stop it with `gh workflow disable watch.yml` and cancel the active run.
