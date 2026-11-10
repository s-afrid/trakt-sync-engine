# Trakt → Letterboxd behavior

## Scope

This app synchronizes watched movies in one direction: Trakt to Letterboxd. It does not sync anime, ratings, TV shows, or Letterboxd history back to Trakt.

## Manual run

The dashboard's **Sync now** action calls `POST /api/sync/trigger`. The route requires an authenticated Trakt session, reads the linked account's watched movies, and applies Letterboxd watch actions via Stremboxd. It records the result in `sync_logs` and persists the successful IMDb IDs and watched timestamp in `sync_settings`.

## Scheduled run

GitHub Actions runs every 15 minutes and can also be started with `workflow_dispatch`. It sends an authenticated request to `GET /api/cron/sync`. `CRON_SECRET` is required; requests without the matching bearer secret are rejected. The deployed app performs the work and records its result in the same database as a manual run.

## Retry rules

- Existing Letterboxd watched status is treated as success and is safe to encounter again.
- Successfully handled movie IDs are persisted to avoid repeat work.
- Movies with an IMDb ID that cannot be matched or updated are kept in a retry queue separate from the timestamp cursor, so one unavailable title cannot block newer watches. Movies without an IMDb ID are reported because they cannot be retried by a stable identifier.
- API rate limits stop the current cycle promptly instead of sending more requests that are expected to fail.

## Required configuration

The server needs Trakt OAuth credentials, a persistent PostgreSQL database, and Stremboxd/Letterboxd automation credentials. The GitHub repository needs a `CRON_SECRET` secret matching the app environment.
