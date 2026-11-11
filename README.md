# Trakt → Letterboxd

A focused web app that copies newly watched movies from one Trakt account to one Letterboxd account. It can run a sync from the dashboard and on a 15-minute GitHub Actions schedule.

## What it does

- Connects to a public Trakt profile by username and reads watched movie history without exchanging an OAuth token.
- Finds films by IMDb ID and marks them watched on Letterboxd through the Stremboxd action API.
- Removes a film from the Letterboxd watchlist after marking it watched.
- Stores a cursor, completed IMDb IDs, and recent run results in PostgreSQL so scheduled runs can resume and retry.
- Shows connection state and recent success, partial, and failed runs in one dashboard.

The sync direction is only **Trakt → Letterboxd**. Letterboxd does not provide this app with a general public write API; the automation uses Stremboxd's Letterboxd actions. Keep those credentials in server environment variables.

## Required environment

Set these in Vercel (or the environment running the Next.js app):

| Variable | Purpose |
| --- | --- |
| `TRAKT_CLIENT_ID` | Trakt API client ID used to look up public profiles and watch history |
| `TRAKT_CLIENT_SECRET` | Only needed by the legacy OAuth flow; username mode does not exchange tokens |
| `TRAKT_REDIRECT_URI` | Optional; callback used only by the legacy OAuth flow |
| `DATABASE_URL` | PostgreSQL connection string; keeps account tokens, sync cursor, and run history |
| `STREMBOXD_USERNAME` | Stremboxd/Letterboxd automation login (or use `LETTERBOXD_USERNAME`) |
| `STREMBOXD_PASSWORD` | Stremboxd/Letterboxd automation password (or use `LETTERBOXD_PASSWORD`) |
| `CREDENTIAL_ENCRYPTION_KEY` | A 32-byte base64 or 64-character hex key used to encrypt credentials saved from the dashboard |
| `CRON_SECRET` | Protects scheduled sync requests |
| `TRAKT_USERNAME` | Optional Trakt username for scheduled runs when its watched history is public; with multiple linked accounts, selects which account to use |

Username mode only works with public Trakt profiles. It skips OAuth token exchange, but still calls Trakt's API using `TRAKT_CLIENT_ID`; it does not provide an API-free connection. Private histories still require OAuth.

For GitHub Actions, add a repository secret named `CRON_SECRET` with the same value configured in Vercel. The workflow calls the deployed app, so Trakt and Letterboxd credentials stay on the server. A missing secret makes the workflow fail closed.

To save Letterboxd automation credentials in the dashboard, generate a key with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` and add it as `CREDENTIAL_ENCRYPTION_KEY` in Vercel. The app does not ask for or store a Trakt password. Existing environment-based Letterboxd credentials continue to work.

## Run locally

```sh
npm install
npm run dev
```

Open `http://localhost:3000`, connect a public Trakt username, enter the Letterboxd username, then use **Sync now**. Configure PostgreSQL before syncing so history and cursors persist. Private Trakt histories require OAuth.

## Deploy

Deploy the repository to Vercel and configure the environment variables above. Configure the database using the existing Drizzle schema. Add the `CRON_SECRET` GitHub repository secret to enable the scheduled and manually dispatched workflow in `.github/workflows/letterboxd-sync.yml`.

## Sync behavior

The sync stores progress only after a film is marked watched (or already confirmed watched). Failed IMDb matches are kept in a retry queue, separate from the timestamp cursor, so one unavailable film cannot block newer watches. A later run is safe to repeat: Letterboxd's existing watched state is checked before toggling. Movies missing an IMDb ID are reported because they cannot be retried by a stable identifier.
