import Papa from "papaparse";
import { XMLParser } from "fast-xml-parser";
import { TraktMovieWatched, TraktRatingItem } from "./trakt";

export interface LetterboxdWatchedRow {
  Title: string;
  Year: number | string;
  tmdbID?: number | string;
  imdbID?: string;
  WatchedDate: string;
}

export interface LetterboxdRatingRow {
  Title: string;
  Year: number | string;
  tmdbID?: number | string;
  imdbID?: string;
  Rating: number; // 0.5 to 5.0
  WatchedDate?: string;
}

export interface LetterboxdRssItem {
  title: string;
  filmTitle: string;
  filmYear?: number;
  tmdbId?: number;
  posterUrl?: string;
  watchedDate?: string;
  rating?: number; // 1-10 scale
  reviewLink?: string;
  guid?: string;
}

export function decodeHtmlEntities(str: string): string {
  if (!str) return "";
  return str
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export class LetterboxdClient {
  /**
   * Convert Trakt watched movies list to Letterboxd import CSV format
   */
  static generateWatchedCsv(watchedMovies: TraktMovieWatched[]): string {
    const rows: LetterboxdWatchedRow[] = watchedMovies.map((item) => ({
      Title: item.movie.title,
      Year: item.movie.year || "",
      tmdbID: item.movie.ids.tmdb || "",
      imdbID: item.movie.ids.imdb || "",
      WatchedDate: item.last_watched_at
        ? new Date(item.last_watched_at).toISOString().split("T")[0]
        : "",
    }));

    return Papa.unparse(rows);
  }

  /**
   * Convert Trakt ratings list to Letterboxd import CSV format
   */
  static generateRatingsCsv(ratings: TraktRatingItem[]): string {
    const rows: LetterboxdRatingRow[] = ratings
      .filter((r) => r.type === "movie" && r.movie)
      .map((item) => ({
        Title: item.movie!.title,
        Year: item.movie!.year || "",
        tmdbID: item.movie!.ids.tmdb || "",
        imdbID: item.movie!.ids.imdb || "",
        // Letterboxd uses a 0.5 - 5.0 star scale; Trakt uses 1 - 10
        Rating: Math.round((item.rating / 2) * 2) / 2,
        WatchedDate: item.rated_at
          ? new Date(item.rated_at).toISOString().split("T")[0]
          : "",
      }));

    return Papa.unparse(rows);
  }

  /**
   * Fetch and parse Letterboxd user RSS feed (live / real-time)
   */
  static async fetchUserRss(username: string): Promise<LetterboxdRssItem[]> {
    const cleanUsername = username.trim().toLowerCase();
    const url = `https://letterboxd.com/${cleanUsername}/rss/`;

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) TraktSyncEngine/1.0",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch Letterboxd RSS for user ${username}: ${res.statusText}`);
    }

    const xmlText = await res.text();
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
    });

    const parsed = parser.parse(xmlText);
    const items = parsed?.rss?.channel?.item;

    if (!items) return [];

    const itemArray = Array.isArray(items) ? items : [items];

    return itemArray.map((it: Record<string, unknown>) => {
      const rawTitle = (it["title"] as string) || "";
      const rawFilmTitle = (it["letterboxd:filmTitle"] as string) || rawTitle;
      const filmTitle = decodeHtmlEntities(rawFilmTitle);
      const title = decodeHtmlEntities(rawTitle);
      const filmYearStr = it["letterboxd:filmYear"] as string;
      const filmYear = filmYearStr ? parseInt(filmYearStr, 10) : undefined;
      const watchedDate = it["letterboxd:watchedDate"] as string;
      const memberRatingStr = it["letterboxd:memberRating"] as string;
      const tmdbIdStr = (it["tmdb:movieId"] as string) || (it["{https://themoviedb.org}movieId"] as string);
      const tmdbId = tmdbIdStr ? parseInt(String(tmdbIdStr), 10) : undefined;
      // Convert Letterboxd rating (0.5 to 5.0) to Trakt rating (1 to 10)
      const rating = memberRatingStr ? Math.round(parseFloat(memberRatingStr) * 2) : undefined;

      // Extract high-resolution movie poster from description HTML tag
      const rawDesc = (it["description"] as string) || "";
      const imgMatch = rawDesc.match(/<img\s+[^>]*src="([^"]+)"/i);
      const posterUrl = imgMatch ? imgMatch[1] : undefined;

      return {
        title,
        filmTitle,
        filmYear,
        tmdbId,
        posterUrl,
        watchedDate,
        rating,
        reviewLink: (it["link"] as string) || "",
        guid: (it["guid"] as string) || "",
      };
    });
  }

  /**
   * Fetch and parse Letterboxd user Watchlist RSS feed
   */
  static async fetchUserWatchlistRss(
    username: string,
    cookieHeader?: string
  ): Promise<LetterboxdRssItem[]> {
    const cleanUsername = username.trim().toLowerCase();
    const url = `https://letterboxd.com/${cleanUsername}/watchlist/rss/`;

    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
      Accept: "application/rss+xml, application/xml, text/xml, */*",
    };
    if (cookieHeader) {
      headers["Cookie"] = cookieHeader;
    }

    const res = await fetch(url, {
      headers,
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch Letterboxd Watchlist RSS for user ${username}: ${res.statusText}`);
    }

    const xmlText = await res.text();
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
    });

    const parsed = parser.parse(xmlText);
    const items = parsed?.rss?.channel?.item;

    if (!items) return [];

    const itemArray = Array.isArray(items) ? items : [items];

    return itemArray.map((it: Record<string, unknown>) => {
      const rawTitle = (it["title"] as string) || "";
      const rawFilmTitle = (it["letterboxd:filmTitle"] as string) || rawTitle;
      const filmTitle = decodeHtmlEntities(rawFilmTitle);
      const title = decodeHtmlEntities(rawTitle);
      const filmYearStr = it["letterboxd:filmYear"] as string;
      const filmYear = filmYearStr ? parseInt(filmYearStr, 10) : undefined;
      const tmdbIdStr = (it["tmdb:movieId"] as string) || (it["{https://themoviedb.org}movieId"] as string);
      const tmdbId = tmdbIdStr ? parseInt(String(tmdbIdStr), 10) : undefined;

      const rawDesc = (it["description"] as string) || "";
      const imgMatch = rawDesc.match(/<img\s+[^>]*src="([^"]+)"/i);
      const posterUrl = imgMatch ? imgMatch[1] : undefined;

      return {
        title,
        filmTitle,
        filmYear,
        tmdbId,
        posterUrl,
        reviewLink: (it["link"] as string) || "",
        guid: (it["guid"] as string) || "",
      };
    });
  }

  /**
   * Fetch Letterboxd user profile metadata (e.g. display name from RSS feed)
   */
  static async fetchUserProfile(
    username: string
  ): Promise<{ username: string; displayName?: string; avatar?: string }> {
    const cleanUsername = username.trim().toLowerCase();
    try {
      const url = `https://letterboxd.com/${cleanUsername}/rss/`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": "TraktSyncEngine/1.0",
        },
        next: { revalidate: 3600 },
      });

      if (!res.ok) {
        return { username: cleanUsername };
      }

      const xmlText = await res.text();
      const parser = new XMLParser({
        ignoreAttributes: false,
      });

      const parsed = parser.parse(xmlText);
      const rawTitle = parsed?.rss?.channel?.title;
      let displayName: string | undefined = undefined;

      if (typeof rawTitle === "string" && rawTitle.startsWith("Letterboxd - ")) {
        displayName = rawTitle.replace(/^Letterboxd\s*-\s*/, "").trim();
      }

      return {
        username: cleanUsername,
        displayName: displayName || cleanUsername,
      };
    } catch {
      return { username: cleanUsername };
    }
  }
}
