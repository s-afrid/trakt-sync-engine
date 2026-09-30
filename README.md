# 🎬 Trakt Sync Engine

<div align="center">

![Next.js](https://img.shields.io/badge/Next.js-15-black?style=for-the-badge&logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=for-the-badge&logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-38B2AC?style=for-the-badge&logo=tailwind-css)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon-336791?style=for-the-badge&logo=postgresql)
![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-0.39-C5F74F?style=for-the-badge&logo=drizzle)
![Vercel](https://img.shields.io/badge/Vercel-Serverless-black?style=for-the-badge&logo=vercel)

**A unified, serverless synchronization platform bridging your watch history, anime progress, and ratings between Trakt.tv, MyAnimeList (MAL), and Letterboxd.**

[Features](#-features) • [How Sync Works](#-how-the-synchronization-engine-works) • [Architecture](#-project-architecture) • [Getting Started](#-getting-started-step-by-step) • [Vercel Deployment](#-deploying-to-vercel) • [API Reference](#-api-routes-reference)

</div>

---

## 📌 Why Trakt Sync Engine?

Media enthusiasts track their entertainment across multiple specialized platforms:
- **Trakt.tv** is unmatched for scrobbling TV shows, tracking episodes, and syncing with media centers (Plex, Jellyfin, Kodi).
- **Letterboxd** is the social standard for film reviews, diary logging, and movie lists.
- **MyAnimeList (MAL)** is the definitive anime database for tracking seasonal anime, manga, and community scores.

Manually logging the same movie on Letterboxd and Trakt, or remembering to increment your anime episodes on MAL after watching them on Trakt, is tedious. **Trakt Sync Engine bridges all three services automatically**, designed specifically to run seamlessly on Vercel's serverless architecture.

---

## ✨ Features

- **Automated Trakt ↔ MyAnimeList Sync**:
  - Automatically identifies anime series from your Trakt history.
  - Resolves cross-platform IDs (`TMDB` / `TVDB` ↔ `MAL ID`) using community mappings ([Fribb/anime-lists](https://github.com/Fribb/anime-lists)) and title fallback search.
  - Syncs watched episode progress and updates MAL statuses (`watching` / `completed`).
  - Converts Trakt 1–10 ratings to MAL scores.
- **1-Click Trakt → Letterboxd Exporter**:
  - Solves Letterboxd's closed API restriction by generating standardized Letterboxd import CSVs (`watched.csv` and `ratings.csv`).
  - Includes verified `tmdbID` and `imdbID` identifiers for 100% match accuracy.
  - Converts Trakt 1–10 ratings to Letterboxd's 0.5–5.0 star rating system.
- **Letterboxd → Trakt RSS Sync**:
  - Monitors your public Letterboxd diary RSS feed to detect newly logged films and scrobble them to Trakt.
- **Zero-Cold-Start Serverless Stack**:
  - Powered by **Next.js 15 App Router**, **Drizzle ORM**, and **Neon Serverless Postgres**.
- **Automated Vercel Cron Scheduling**:
  - Automatically triggers daily incremental background syncs at `04:00 UTC` via `vercel.json`.
- **Hybrid Storage Modes**:
  - Works in **Cookie Mode** out of the box for quick local testing without any database.
  - Switches to **Neon PostgreSQL Mode** for multi-user support, sync audit logs, and persistent cron execution.
- **Native Harbor Design System**:
  - The dashboard shares the exact color tokens, typography, iconography, and logo lockup used by the [Harbor](https://github.com/s-afrid) desktop player, so both surfaces read as one product.

---

## 🎨 Design System (Harbor)

The UI is a first-party Harbor surface. Tokens live in `app/globals.css` and are exposed to
Tailwind through `tailwind.config.ts`, so **never hard-code a hex value in a component** —
use the semantic class instead.

| Token | Class | Value | Harbor source |
| --- | --- | --- | --- |
| Page background | `bg-canvas` | `#111213` | `oklch(0.18 0.004 260)` |
| Cards / panels | `bg-surface` | `#191b1c` | `oklch(0.22 0.004 260)` |
| Raised rows, hover | `bg-elevated` | `#252628` | `oklch(0.27 0.004 260)` |
| Buttons, chips | `bg-raised` | `#323335` | `oklch(0.32 0.004 260)` |
| Primary text | `text-ink` | `#f4f5f7` | `oklch(0.97 0.003 260)` |
| Secondary text | `text-ink-muted` | `#a3a5a6` | `oklch(0.72 0.003 260)` |
| Tertiary text | `text-ink-subtle` | `#626365` | `oklch(0.50 0.003 260)` |
| Borders / dividers | `border-edge` | `#282a2b` | `oklch(0.36 0.004 260 / 55%)` over canvas |
| Brand accent | `bg-accent` / `text-accent` | `#f4a25c` | `oklch(0.78 0.13 60)` |
| Positive state | `bg-success` | `#45b164` | `oklch(0.68 0.15 150)` |
| Negative state | `bg-danger` | `#c53637` | `oklch(0.55 0.18 25)` |

- Tokens are stored as **space-separated sRGB channels**, so Tailwind opacity modifiers work
  everywhere: `bg-surface/60`, `border-edge/40`, `text-accent/90`.
- Amber/gold is the single brand accent (matches Harbor's `--color-accent`); green and red are
  reserved for **status only** — never for decoration.
- Platform brand colors stay literal: Trakt `#ED1C24`, MyAnimeList `#2E51A2`,
  Letterboxd `#00E054` / `#FF8000` / `#40BCF4`.
- Typography mirrors Harbor: **Switzer** for UI, **Sentient** for the wordmark
  (`.harbor-wordmark`), **JetBrains Mono** for telemetry.
- Brand assets are mirrored from Harbor: `public/harbor-mark.svg`, `public/harbor-wordmark.svg`,
  `public/harbor-icon.png`, plus the `<HarborMark />` / `<HarborLogo />` React components in
  `components/icons.tsx`.
- Reusable primitives: `.harbor-card`, `.harbor-chip`, `.harbor-chip-accent`,
  `.harbor-chip-success`, `.harbor-chip-danger`, `.harbor-btn-primary`, `.harbor-btn-ghost`,
  `.harbor-label`, `.harbor-glow`.


## 🔄 How the Synchronization Engine Works

```mermaid
flowchart TD
    subgraph Core ["Trakt Sync Engine (Vercel)"]
        UI["Modern Dashboard UI"]
        Engine["Sync Service Coordinator"]
        Mapper["Anime ID Resolver (TMDB/TVDB ↔ MAL)"]
        Cron["Vercel Cron (/api/cron/sync)"]
        DB[("Neon Serverless Postgres")]
    end

    subgraph Trakt ["Trakt.tv"]
        TraktWatched["Watched Movies & Shows"]
        TraktRatings["Movie & TV Ratings"]
    end

    subgraph MAL ["MyAnimeList"]
        MALList["User Animelist (Status & Episodes)"]
    end

    subgraph Letterboxd ["Letterboxd"]
        LBCSV["CSV Import (/watched.csv & /ratings.csv)"]
        LBRSS["Public Diary RSS Feed"]
    end

    TraktWatched -->|Fetch History| Engine
    TraktRatings -->|Fetch Ratings| Engine

    Engine -->|Resolve IDs| Mapper
    Mapper -->|Update Progress & Score| MALList

    Engine -->|Generate 1-Click CSV| LBCSV
    LBRSS -->|Read New Diary Entries| Engine
    Engine -->|Scrobble to Trakt| TraktWatched

    Cron --> Engine
    Engine <--> DB
    UI --> Engine
```

### 1. Trakt to MyAnimeList
1. Fetches your watched TV shows from Trakt (`/sync/watched/shows?extended=full`).
2. Filters out standard television shows to identify anime series.
3. Resolves each show's `TMDB` or `TVDB` ID to a MyAnimeList `mal_id` via:
   - In-memory & DB mapping cache.
   - Community-maintained database mapping ([Fribb/anime-lists](https://github.com/Fribb/anime-lists)).
   - Fallback title search via MAL API v2.
4. Compares the episode count on Trakt against your MAL animelist.
5. If Trakt is ahead, calls MAL's `PATCH /v2/anime/{id}/my_list_status` to update `num_watched_episodes`, watch status (`watching` / `completed`), and score.

### 2. Trakt to Letterboxd
Because Letterboxd's official API is strictly closed to partner businesses, this engine implements the **official Letterboxd import CSV standard**:
- Pulls your watched movie history and ratings from Trakt.
- Maps `tmdb_id` and `imdb_id` so Letterboxd never mismatches film versions or remakes.
- Formats dates into ISO format (`YYYY-MM-DD`).
- Converts Trakt 1–10 scores to Letterboxd's 0.5–5.0 star scale.
- Downloads directly with 1 click for instant upload at [letterboxd.com/import](https://letterboxd.com/import/).

### 3. Letterboxd to Trakt (RSS)
- Letterboxd provides a public RSS feed for every user at `letterboxd.com/<username>/rss/`.
- The engine parses recent diary logs and syncs films logged on Letterboxd into Trakt history.

---

## ⏰ 15-Minute Background Cloud Sync & Letterboxd Session Management

The synchronization engine operates autonomously via a 4-pillar contract:
1. **15-Minute Cycle**: The cloud runner (`.github/workflows/letterboxd-sync.yml`) runs every 15 minutes.
2. **Quiet Sleep (Smart Diffing)**: If no new movies or episodes were watched on Trakt since the last run, it sleeps quietly with 0% CPU and never launches browser windows.
3. **Automated Anime Sync**: Triggers instant synchronization of watched episodes and series status from Trakt to MyAnimeList.
4. **Automated Movie Sync**: Compiles verified Trakt movie history into standard Letterboxd CSVs and auto-imports them into Letterboxd via Playwright with session persistence.

### 🛡️ Fail-Safe Session Renewal (Cookie Expiration)
Because Letterboxd uses Cloudflare Turnstile bot protection, automated logins in headless environments may fail if the saved cookie session expires. When this happens:

1. **Export Fresh Cookies**:
   - Open [letterboxd.com](https://letterboxd.com) in your regular browser while logged in.
   - Click the [Cookie-Editor extension](https://cookie-editor.com/) icon.
   - Click **Export** ➔ **Export as JSON**.
2. **Update in 1 Click**:
   - **In the Web App**: Navigate to the Dashboard or **Live Activity (24h)** tab, locate the **Letterboxd Cookie Session** banner, click **Update Session**, and paste your exported JSON.
   - **In GitHub Secrets**: Go to your GitHub repository ➔ **Settings** ➔ **Secrets and variables** ➔ **Actions**, and update the secret `LETTERBOXD_SESSION_JSON` with the exported JSON string.
3. **Verify**:
   - The web app displays a live session badge (`🟢 Active & Verified` or `🔴 Expired`) and shows the exact expiration date.
   - GitHub Actions will automatically use the updated session on its next 15-minute scheduled run.

## 📂 Project Architecture

```text
trakt-sync-engine/
├── app/
│   ├── api/
│   │   ├── auth/
│   │   │   ├── trakt/
│   │   │   │   ├── authorize/route.ts  # Trakt OAuth initiation
│   │   │   │   └── callback/route.ts   # Trakt token exchange & user profile
│   │   │   ├── mal/
│   │   │   │   ├── authorize/route.ts  # MAL PKCE OAuth initiation
│   │   │   │   └── callback/route.ts   # MAL token exchange & user profile
│   │   │   └── letterboxd/
│   │   │       └── save/route.ts       # Letterboxd username saving
│   │   ├── export/
│   │   │   └── letterboxd/route.ts     # Generates & streams Letterboxd CSVs
│   │   ├── sync/
│   │   │   ├── status/route.ts         # Connection state, profiles, and logs
│   │   │   └── trigger/route.ts        # Manual sync trigger
│   │   └── cron/
│   │       └── sync/route.ts           # Vercel Cron automated daily sync
│   ├── globals.css                     # Custom Tailwind styling & dark mode
│   ├── layout.tsx                      # Root layout & page metadata
│   └── page.tsx                        # Main sync dashboard interface
├── lib/
│   ├── clients/
│   │   ├── trakt.ts                    # Trakt API client (history, shows, ratings)
│   │   ├── mal.ts                      # MyAnimeList API client (PKCE, animelist)
│   │   ├── letterboxd.ts               # Letterboxd CSV generator & RSS parser
│   │   └── mapper.ts                   # TMDB/TVDB ↔ MAL cross-ID mapper
│   ├── db/
│   │   ├── schema.ts                   # Drizzle ORM database schema
│   │   └── index.ts                    # Serverless Neon DB connection client
│   ├── sync/
│   │   ├── anime-sync.ts               # Trakt -> MAL synchronization logic
│   │   └── letterboxd-sync.ts          # Letterboxd RSS -> Trakt sync logic
│   └── utils.ts                        # Tailwind class mergers & formatters
├── vercel.json                         # Vercel Cron schedule configuration
├── drizzle.config.ts                   # Drizzle ORM migration configuration
├── .env.example                        # Template for environment variables
├── package.json
└── tsconfig.json
```

---

## 🚀 Getting Started (Step-by-Step)

### 1. Prerequisites
- **Node.js** v20+ installed.
- Accounts on [Trakt.tv](https://trakt.tv), [MyAnimeList](https://myanimelist.net), and [Letterboxd](https://letterboxd.com).

### 2. Configure API Applications

#### A. Trakt.tv Application
1. Go to [Trakt Applications](https://trakt.tv/oauth/applications) and sign in.
2. Click **New Application**.
3. Fill in:
   - **Name**: `Trakt Sync Engine`
   - **Redirect URI**: 
     - For local development: `http://localhost:3000/api/auth/trakt/callback`
     - For Vercel production: `https://your-domain.vercel.app/api/auth/trakt/callback`
   - **Permissions**: Check `public` and `checkin`.
4. Click **Save App** and copy your **Client ID** and **Client Secret**.

#### B. MyAnimeList Application
1. Go to [MyAnimeList API Config](https://myanimelist.net/apiconfig) and sign in.
2. Click **Create ID**.
3. Fill in:
   - **App Name**: `TraktSyncEngine`
   - **App Type**: Select `Web`.
   - **App Redirect URL**: 
     - For local development: `http://localhost:3000/api/auth/mal/callback`
     - For Vercel production: `https://your-domain.vercel.app/api/auth/mal/callback`
   - **Purpose of use**: `Personal watch history sync`
4. Click **Submit** and copy your **Client ID** and **Client Secret**.

### 3. Setup Local Environment

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Paste your API credentials into `.env`:

```ini
NEXT_PUBLIC_APP_URL="http://localhost:3000"
APP_SECRET="replace-with-a-random-32-char-secret"

# Trakt API Keys
TRAKT_CLIENT_ID="your_trakt_client_id"
TRAKT_CLIENT_SECRET="your_trakt_client_secret"
TRAKT_REDIRECT_URI="http://localhost:3000/api/auth/trakt/callback"

# MyAnimeList API Keys
MAL_CLIENT_ID="your_mal_client_id"
MAL_CLIENT_SECRET="your_mal_client_secret"
MAL_REDIRECT_URI="http://localhost:3000/api/auth/mal/callback"

# Database (Optional for basic testing, required for persistent cron)
DATABASE_URL="postgresql://user:password@ep-xyz.us-east-2.aws.neon.tech/neondb?sslmode=require"

# Vercel Cron Secret
CRON_SECRET="your_custom_cron_token"

# Stremboxd credentials (required for Trakt -> Letterboxd movie sync)
STREMBOXD_USERNAME="your_stremboxd_username"
STREMBOXD_PASSWORD="your_stremboxd_password"
```

The dashboard's Trigger Sync Engine button runs both Trakt -> MAL and Trakt -> Letterboxd movie syncs. The Letterboxd movie sync requires Stremboxd credentials; LETTERBOXD_USERNAME and LETTERBOXD_PASSWORD can be used as a fallback.

### 4. Database Setup (Optional for Local, Required for Production)

If using [Neon](https://neon.tech) or a local PostgreSQL database, push the schema:

```bash
npm run db:push
```

### 5. Run the Local Development Server

```bash
npm run dev
```

---

## ?? Cron Scheduling & Vercel Plan Limits

> **Keep the `vercel.json` cron daily on a Hobby plan.** Vercel Hobby allows one cron run per day, and may invoke it at any time during the configured hour. The daily Vercel cron remains a safety net.

The repository's GitHub Actions workflow calls `GET /api/cron/sync` every 15 minutes. This provides a free scheduled trigger for the sync; GitHub may delay scheduled runs during heavy load, so it is best-effort rather than an exact 15-minute guarantee.

Configure these values:

- In Vercel Project Settings > Environment Variables, set `CRON_SECRET` to a long random value.
- In GitHub repository Settings > Secrets and variables > Actions > Repository secrets, add `CRON_SECRET` with the **same value**.
- Optionally add the Actions variable `SYNC_APP_URL` if the deployed app uses a different host. The default is `https://trakt-sync-engine.vercel.app`.

The Vercel endpoint authenticates the bearer token and uses the database and integration credentials configured in Vercel. You can also run the workflow on demand with **Actions > 15-Minute Trakt Cloud Sync > Run workflow**.

Open your browser at **[http://localhost:3000](http://localhost:3000)**.

---

## 🚢 Deploying to Vercel

1. **Push your code to GitHub**:
   ```bash
   git add .
   git commit -m "feat: setup trakt sync engine"
   git push origin main
   ```
2. **Import into Vercel**:
   - Go to [Vercel Dashboard](https://vercel.com) and click **Add New Project**.
   - Select your repository.
3. **Configure Environment Variables in Vercel**:
   Under **Project Settings → Environment Variables**, add:
   - `NEXT_PUBLIC_APP_URL`: `https://<your-app>.vercel.app`
   - `APP_SECRET`: Any 32-character random string.
   - `TRAKT_CLIENT_ID`: Your Trakt client ID.
   - `TRAKT_CLIENT_SECRET`: Your Trakt client secret.
   - `TRAKT_REDIRECT_URI`: `https://<your-app>.vercel.app/api/auth/trakt/callback`
   - `MAL_CLIENT_ID`: Your MAL client ID.
   - `MAL_CLIENT_SECRET`: Your MAL client secret.
   - `MAL_REDIRECT_URI`: `https://<your-app>.vercel.app/api/auth/mal/callback`
   - `DATABASE_URL`: Your Neon PostgreSQL connection string.
   - `CRON_SECRET`: A long random token for securing Vercel Cron. Add the same value as a GitHub Actions repository secret named `CRON_SECRET` to enable the 15-minute workflow.
   - `STREMBOXD_USERNAME` and `STREMBOXD_PASSWORD`: Required for Trakt -> Letterboxd movie sync. You may instead set `LETTERBOXD_USERNAME` and `LETTERBOXD_PASSWORD`.
4. **Update OAuth Redirects**:
   - Update your Trakt application redirect URI to `https://<your-app>.vercel.app/api/auth/trakt/callback`.
   - Update your MAL application redirect URI to `https://<your-app>.vercel.app/api/auth/mal/callback`.
5. **Deploy**:
   - Click **Deploy**. Vercel will build the production application and automatically schedule the daily cron job specified in `vercel.json`.

---

## 🔌 API Routes Reference

| Endpoint | Method | Description | Auth Required |
| :--- | :---: | :--- | :---: |
| `/api/auth/trakt/authorize` | `GET` | Initiates Trakt OAuth2 authorization flow. | No |
| `/api/auth/trakt/callback` | `GET` | Handles Trakt OAuth callback and token exchange. | No |
| `/api/auth/mal/authorize` | `GET` | Initiates MAL OAuth2 with PKCE (`code_verifier`). | No |
| `/api/auth/mal/callback` | `GET` | Handles MAL PKCE OAuth callback and token exchange. | No |
| `/api/auth/letterboxd/save` | `POST` | Saves Letterboxd username to session/DB. | No |
| `/api/export/letterboxd` | `GET` | Streams standard Letterboxd `watched.csv` or `ratings.csv`. | Yes (Trakt) |
| `/api/sync/status` | `GET` | Returns connection states, user profiles, and logs. | No |
| `/api/sync/trigger` | `POST` | Triggers Trakt -> MAL, Trakt -> Letterboxd movies, and Letterboxd RSS -> Trakt syncs when configured. | Yes (Trakt) |
| `/api/cron/sync` | `GET` | Automated daily background sync triggered by Vercel Cron. | Bearer `CRON_SECRET` |

---

## ❓ Frequently Asked Questions

<details>
<summary><b>Why doesn't the app sync to Letterboxd directly via API?</b></summary>
Letterboxd does not provide an open public API for independent hobbyist developers. Their API is strictly invite-only for commercial partners. Trakt Sync Engine bypasses this by generating native, verified Letterboxd CSVs (with TMDB/IMDb IDs) that can be imported into Letterboxd in 1 click at <a href="https://letterboxd.com/import/">letterboxd.com/import</a>.
</details>

<details>
<summary><b>How does anime episode matching handle seasons and specials?</b></summary>
Trakt organizes anime seasons differently than MyAnimeList (MAL treats each season or movie as an independent entry with 12/24 episodes). The <code>AnimeMapper</code> resolves the exact MAL ID for each TVDB/TMDB entry, ignoring Season 0 (specials) to ensure your episode progress on MAL increments accurately.
</details>

<details>
<summary><b>Will large libraries cause serverless timeouts on Vercel?</b></summary>
The sync engine uses batching and incremental timestamps (<code>last_synced_at</code>). When syncing with MAL, only anime whose episode counts or ratings differ are updated, staying well within Vercel serverless execution limits.
</details>

---

## 📄 License

This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for details.