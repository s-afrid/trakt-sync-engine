# Trakt Sync Engine

A full-stack synchronization web application designed to bridge your watch history, anime progress, and ratings between **Trakt.tv**, **MyAnimeList (MAL)**, and **Letterboxd**, built specifically for deployment on **Vercel Serverless**.

---

## ✨ Features

- **Trakt ↔ MyAnimeList Synchronization**:
  - Automatically identifies anime series from your Trakt watch history.
  - Resolves cross-platform IDs (`TMDB` / `TVDB` ↔ `MAL ID`) using community mappings ([Fribb/anime-lists](https://github.com/Fribb/anime-lists)) and title fallback.
  - Automatically updates episodes watched and watch status (`watching` / `completed`) on MAL.
  - Syncs ratings (converts Trakt 1-10 to MAL 1-10 score).
- **Trakt → Letterboxd 1-Click Exporter**:
  - Generates standardized Letterboxd import CSV files (`watched.csv` and `ratings.csv`) complete with TMDB and IMDb IDs.
  - Converts 1-10 Trakt ratings to Letterboxd's 0.5 - 5.0 star scale.
  - 1-click import into Letterboxd's native import page.
- **Letterboxd → Trakt RSS Sync**:
  - Monitors your public Letterboxd diary RSS feed to sync newly watched movies into Trakt.
- **Vercel Serverless & Cron Ready**:
  - Configured with `vercel.json` for daily automated background synchronization at `04:00 UTC`.
  - Neon Serverless Postgres integration with Drizzle ORM for zero-cold-start performance.

---

## 🛠️ Tech Stack

- **Framework**: Next.js 15 (App Router, TypeScript)
- **Styling**: Tailwind CSS & Lucide Icons
- **Database / ORM**: PostgreSQL (Neon Serverless) + Drizzle ORM
- **Authentication**:
  - Trakt.tv: OAuth 2.0
  - MyAnimeList: OAuth 2.0 with PKCE (RFC 7636)
- **Parser**: Fast-XML-Parser (for Letterboxd RSS) & PapaParse (for CSV generation)

---

## 🚀 Getting Started

### 1. Prerequisites

- [Node.js](https://nodejs.org/) v20+
- A [Trakt.tv](https://trakt.tv) account
- A [MyAnimeList](https://myanimelist.net) account
- A [Letterboxd](https://letterboxd.com) account

### 2. Configure Developer Applications

#### A. Trakt.tv API
1. Navigate to [Trakt Applications](https://trakt.tv/oauth/applications).
2. Click **New Application**.
3. Set **Name**: `Trakt Sync Engine`.
4. Set **Redirect URI**:
   - Local: `http://localhost:3000/api/auth/trakt/callback`
   - Production: `https://your-app.vercel.app/api/auth/trakt/callback`
5. Save and copy `Client ID` and `Client Secret`.

#### B. MyAnimeList API
1. Go to [MyAnimeList API Config](https://myanimelist.net/apiconfig).
2. Click **Create ID**.
3. **App Type**: Select `Web`.
4. **Redirect URI**:
   - Local: `http://localhost:3000/api/auth/mal/callback`
   - Production: `https://your-app.vercel.app/api/auth/mal/callback`
5. Save and copy `Client ID` and `Client Secret`.

### 3. Environment Setup

Create a `.env` file from `.env.example`:

```bash
cp .env.example .env
```

Fill in the credentials:

```ini
NEXT_PUBLIC_APP_URL="http://localhost:3000"
APP_SECRET="replace-with-a-random-32-char-secret"

# PostgreSQL Connection (e.g. Neon.tech serverless postgres)
DATABASE_URL="postgresql://user:password@ep-xyz.us-east-2.aws.neon.tech/neondb?sslmode=require"

# Trakt.tv
TRAKT_CLIENT_ID="your_trakt_client_id"
TRAKT_CLIENT_SECRET="your_trakt_client_secret"
TRAKT_REDIRECT_URI="http://localhost:3000/api/auth/trakt/callback"

# MyAnimeList
MAL_CLIENT_ID="your_mal_client_id"
MAL_CLIENT_SECRET="your_mal_client_secret"
MAL_REDIRECT_URI="http://localhost:3000/api/auth/mal/callback"

# Vercel Cron Secret
CRON_SECRET="your_custom_cron_token"
```

### 4. Push Database Schema

If using PostgreSQL/Neon:

```bash
npm run db:push
```

---

## 🚢 Deploying to Vercel

1. Push your code to GitHub.
2. Go to [Vercel Dashboard](https://vercel.com) and click **Add New Project**.
3. Import your `trakt-sync-engine` repository.
4. Add your **Environment Variables** in the Vercel project settings:
   - `NEXT_PUBLIC_APP_URL` (`https://your-app.vercel.app`)
   - `TRAKT_CLIENT_ID`
   - `TRAKT_CLIENT_SECRET`
   - `TRAKT_REDIRECT_URI` (`https://your-app.vercel.app/api/auth/trakt/callback`)
   - `MAL_CLIENT_ID`
   - `MAL_CLIENT_SECRET`
   - `MAL_REDIRECT_URI` (`https://your-app.vercel.app/api/auth/mal/callback`)
   - `DATABASE_URL` (Neon Postgres database URL)
   - `CRON_SECRET`
5. Click **Deploy**. Vercel will automatically configure the daily cron job specified in `vercel.json`.

---

## 📄 License

MIT