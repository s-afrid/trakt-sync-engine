# Trakt → Letterboxd

A focused web app that copies newly watched movies from one Trakt account to one Letterboxd account. It can run a sync from the dashboard and on a 15-minute GitHub Actions schedule.

## What it does

- Connects Trakt with OAuth and reads watched movie history.
- Finds films by IMDb ID and marks them watched on Letterboxd through the Stremboxd action API.
- Removes a film from the Letterboxd watchlist after marking it watched.
- Stores a cursor, completed IMDb IDs, and recent run results in PostgreSQL so scheduled runs can resume and retry.
- Shows connection state and recent success, partial, and failed runs in one dashboard.

The sync direction is only **Trakt → Letterboxd**. Letterboxd does not provide this app with a general public write API; the automation uses Stremboxd's Letterboxd actions. Keep those credentials in server environment variables.

## Required environment

Set these in Vercel (or the environment running the Next.js app):

| Variable | Purpose |
| --- | --- |
| `TRAKT_CLIENT_ID` | Trakt OAuth application ID |
| `TRAKT_CLIENT_SECRET` | Trakt OAuth application secret |
| `TRAKT_REDIRECT_URI` | Optional; defaults to `https://<your-domain>/api/auth/trakt/callback` |
| `DATABASE_URL` | PostgreSQL connection string; keeps account tokens, sync cursor, and run history |
| `STREMBOXD_USERNAME` | Stremboxd/Letterboxd automation login (or use `LETTERBOXD_USERNAME`) |
| `STREMBOXD_PASSWORD` | Stremboxd/Letterboxd automation password (or use `LETTERBOXD_PASSWORD`) |
| `CRON_SECRET` | Protects scheduled sync requests |
| `TRAKT_USERNAME` | Trakt username for scheduled runs. OAuth is optional when this profile's watched history is public; with multiple linked accounts, it selects which account to use |

In the Trakt developer settings, set the redirect URL to the same callback URL configured above. In Vercel, keep the production URL in `TRAKT_REDIRECT_URI` if you use a custom domain.

For GitHub Actions, add a repository secret named `CRON_SECRET` with the same value configured in Vercel. The workflow calls the deployed app, so Trakt and Letterboxd credentials stay on the server. A missing secret makes the workflow fail closed.

## Run locally

```sh
npm install
npm run dev
```

Open `http://localhost:3000`, connect Trakt, enter the Letterboxd username, then use **Sync now**. OAuth is needed for the dashboard's manual button and for private Trakt histories. A public Trakt profile can be read by scheduled runs using `TRAKT_USERNAME`. Configure PostgreSQL before syncing so history and cursors persist.

## Deploy

Deploy the repository to Vercel and configure the environment variables above. Configure the database using the existing Drizzle schema. Add the `CRON_SECRET` GitHub repository secret to enable the scheduled and manually dispatched workflow in `.github/workflows/letterboxd-sync.yml`.

## Sync behavior

The sync stores progress only after a film is marked watched (or already confirmed watched). Failed IMDb matches are kept in a retry queue, separate from the timestamp cursor, so one unavailable film cannot block newer watches. A later run is safe to repeat: Letterboxd's existing watched state is checked before toggling. Movies missing an IMDb ID are reported because they cannot be retried by a stable identifier.
