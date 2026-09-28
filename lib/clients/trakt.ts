export interface TraktTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
  created_at: number;
}

export interface TraktUser {
  username: string;
  name: string;
  vip: boolean;
  joined_at: string;
  images?: {
    avatar?: {
      full?: string;
    };
  };
  ids: {
    slug: string;
  };
}

export interface TraktMovieWatched {
  plays: number;
  last_watched_at: string;
  last_updated_at: string;
  movie: {
    title: string;
    year: number;
    ids: {
      trakt: number;
      slug: string;
      imdb?: string;
      tmdb?: number;
    };
    genres?: string[];
    overview?: string;
    rating?: number;
    images?: {
      poster?: string[];
      fanart?: string[];
      banner?: string[];
      thumb?: string[];
    };
  };
}

export interface TraktShowWatched {
  plays: number;
  last_watched_at: string;
  last_updated_at: string;
  reset_at?: string | null;
  show: {
    title: string;
    year: number;
    ids: {
      trakt: number;
      slug: string;
      imdb?: string;
      tmdb?: number;
      tvdb?: number;
    };
    genres?: string[];
    aired_episodes?: number;
    status?: string;
  };
  seasons: {
    number: number;
    episodes: {
      number: number;
      plays: number;
      last_watched_at: string;
    }[];
  }[];
}

export interface TraktRatingItem {
  rated_at: string;
  rating: number; // 1-10
  type: "movie" | "show" | "season" | "episode";
  movie?: {
    title: string;
    year: number;
    ids: { trakt: number; imdb?: string; tmdb?: number };
  };
  show?: {
    title: string;
    year: number;
    ids: { trakt: number; imdb?: string; tmdb?: number; tvdb?: number };
  };
}

export interface TraktWatchlistItem {
  id: number;
  listed_at: string;
  type: "movie" | "show";
  movie?: {
    title: string;
    year: number;
    ids: {
      trakt: number;
      slug: string;
      imdb?: string;
      tmdb?: number;
    };
    overview?: string;
    rating?: number;
    genres?: string[];
  };
  show?: {
    title: string;
    year: number;
    ids: {
      trakt: number;
      slug: string;
      imdb?: string;
      tmdb?: number;
      tvdb?: number;
    };
    overview?: string;
    rating?: number;
    genres?: string[];
    aired_episodes?: number;
  };
}

export interface TraktEpisodeHistoryItem {
  id: number;
  watched_at: string;
  action: string;
  type: string;
  episode: {
    season: number;
    number: number;
    title: string;
    overview?: string;
    images?: {
      screenshot?: string[];
    };
    ids: {
      trakt: number;
      tvdb?: number;
      imdb?: string;
      tmdb?: number;
    };
  };
  show: {
    title: string;
    year?: number;
    overview?: string;
    genres?: string[];
    images?: {
      poster?: string[];
      fanart?: string[];
      banner?: string[];
      thumb?: string[];
    };
    ids: {
      trakt: number;
      slug: string;
      tvdb?: number;
      imdb?: string;
      tmdb?: number;
    };
  };
}

export class TraktClient {
  private get clientId(): string {
    return (process.env.TRAKT_CLIENT_ID || "").trim();
  }

  private get clientSecret(): string {
    return (process.env.TRAKT_CLIENT_SECRET || "").trim();
  }

  private accessToken?: string;
  private username?: string;

  constructor(accessToken?: string, username?: string) {
    this.accessToken = accessToken?.trim();
    this.username = username?.trim();
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "trakt-api-version": "2",
      "trakt-api-key": this.clientId,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    };
    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }
    return headers;
  }

  static getAuthorizeUrl(redirectUri: string, state?: string): string {
    const clientId = process.env.TRAKT_CLIENT_ID || "";
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      state: state || "",
    });
    return `https://trakt.tv/oauth/authorize?${params.toString()}`;
  }

  static async exchangeCodeForToken(
    code: string,
    redirectUri: string
  ): Promise<TraktTokenResponse> {
    const res = await fetch("https://api.trakt.tv/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        client_id: process.env.TRAKT_CLIENT_ID,
        client_secret: process.env.TRAKT_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Trakt token exchange failed (${res.status}): ${err}`);
    }

    return res.json();
  }

  static async refreshAccessToken(
    refreshToken: string,
    redirectUri: string
  ): Promise<TraktTokenResponse> {
    const res = await fetch("https://api.trakt.tv/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        refresh_token: refreshToken,
        client_id: process.env.TRAKT_CLIENT_ID,
        client_secret: process.env.TRAKT_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Trakt token refresh failed (${res.status}): ${err}`);
    }

    return res.json();
  }

  async getCurrentUser(): Promise<TraktUser> {
    const endpoint = this.accessToken
      ? "https://api.trakt.tv/users/me?extended=full"
      : `https://api.trakt.tv/users/${this.username}?extended=full`;

    const res = await fetch(endpoint, {
      headers: this.getHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch Trakt user: ${res.statusText}`);
    }
    return res.json();
  }

  async getWatchedMovies(): Promise<TraktMovieWatched[]> {
    const watchedEndpoint = this.accessToken
      ? "https://api.trakt.tv/sync/watched/movies?extended=full"
      : `https://api.trakt.tv/users/${this.username}/watched/movies?extended=full`;

    const historyEndpoint = this.accessToken
      ? "https://api.trakt.tv/sync/history/movies?limit=100"
      : `https://api.trakt.tv/users/${this.username}/history/movies?limit=100`;

    const [watchedRes, historyRes] = await Promise.all([
      fetch(watchedEndpoint, { headers: this.getHeaders(), cache: "no-store" }),
      fetch(historyEndpoint, { headers: this.getHeaders(), cache: "no-store" }).catch(() => null),
    ]);

    if (!watchedRes.ok) {
      throw new Error(`Failed to fetch watched movies: ${watchedRes.statusText}`);
    }

    const watched: TraktMovieWatched[] = await watchedRes.json();
    const history: { watched_at: string; movie: TraktMovieWatched["movie"] }[] =
      historyRes && historyRes.ok ? await historyRes.json().catch(() => []) : [];

    // Map by trakt ID to merge any recently watched movies not yet indexed in watched table
    const movieMap = new Map<number, TraktMovieWatched>();
    for (const w of watched) {
      if (w.movie?.ids?.trakt) {
        movieMap.set(w.movie.ids.trakt, w);
      }
    }

    for (const h of history) {
      const traktId = h.movie?.ids?.trakt;
      if (!traktId) continue;

      const existing = movieMap.get(traktId);
      if (!existing) {
        movieMap.set(traktId, {
          plays: 1,
          last_watched_at: h.watched_at,
          last_updated_at: h.watched_at,
          movie: h.movie,
        });
      } else {
        // Update last_watched_at if history has a newer timestamp
        if (new Date(h.watched_at) > new Date(existing.last_watched_at)) {
          existing.last_watched_at = h.watched_at;
          existing.last_updated_at = h.watched_at;
        }
      }
    }

    return Array.from(movieMap.values());
  }

  async getWatchedShows(): Promise<TraktShowWatched[]> {
    const endpoint = this.accessToken
      ? "https://api.trakt.tv/sync/watched/shows?extended=full"
      : `https://api.trakt.tv/users/${this.username}/watched/shows?extended=full`;

    const res = await fetch(endpoint, {
      headers: this.getHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch watched shows: ${res.statusText}`);
    }
    return res.json();
  }

  async getWatchlistMovies(): Promise<TraktWatchlistItem[]> {
    const endpoint = this.accessToken
      ? "https://api.trakt.tv/sync/watchlist/movies?extended=full"
      : `https://api.trakt.tv/users/${this.username}/watchlist/movies?extended=full`;

    const res = await fetch(endpoint, {
      headers: this.getHeaders(),
      cache: "no-store",
    });
    if (!res.ok) return [];
    return res.json();
  }

  async getWatchlistShows(): Promise<TraktWatchlistItem[]> {
    const endpoint = this.accessToken
      ? "https://api.trakt.tv/sync/watchlist/shows?extended=full"
      : `https://api.trakt.tv/users/${this.username}/watchlist/shows?extended=full`;

    const res = await fetch(endpoint, {
      headers: this.getHeaders(),
      cache: "no-store",
    });
    if (!res.ok) return [];
    return res.json();
  }

  async getMovieRatings(): Promise<TraktRatingItem[]> {
    const endpoint = this.accessToken
      ? "https://api.trakt.tv/sync/ratings/movies"
      : `https://api.trakt.tv/users/${this.username}/ratings/movies`;

    const res = await fetch(endpoint, {
      headers: this.getHeaders(),
      cache: "no-store",
    });
    if (!res.ok) return [];
    return res.json();
  }

  async getShowRatings(): Promise<TraktRatingItem[]> {
    const endpoint = this.accessToken
      ? "https://api.trakt.tv/sync/ratings/shows"
      : `https://api.trakt.tv/users/${this.username}/ratings/shows`;

    const res = await fetch(endpoint, {
      headers: this.getHeaders(),
      cache: "no-store",
    });
    if (!res.ok) return [];
    return res.json();
  }

  async getUserEpisodeHistory(limit: number = 500): Promise<TraktEpisodeHistoryItem[]> {
    const endpoint = this.accessToken
      ? `https://api.trakt.tv/sync/history/episodes?extended=full&limit=${limit}`
      : `https://api.trakt.tv/users/${this.username}/history/episodes?extended=full&limit=${limit}`;

    const res = await fetch(endpoint, {
      headers: this.getHeaders(),
      cache: "no-store",
    });
    if (!res.ok) return [];
    return res.json();
  }

  async getShowEpisodeHistory(
    showTraktId: number,
    limit: number = 100
  ): Promise<TraktEpisodeHistoryItem[]> {
    const endpoint = this.accessToken
      ? `https://api.trakt.tv/sync/history/shows/${showTraktId}?limit=${limit}`
      : `https://api.trakt.tv/users/${this.username}/history/shows/${showTraktId}?limit=${limit}`;

    const res = await fetch(endpoint, {
      headers: this.getHeaders(),
      cache: "no-store",
    });
    if (!res.ok) return [];
    return res.json();
  }


  async addToHistory(payload: {
    movies?: { ids: { trakt?: number; tmdb?: number; imdb?: string }; watched_at?: string }[];
    episodes?: { ids: { trakt?: number }; watched_at?: string }[];
  }) {
    const res = await fetch("https://api.trakt.tv/sync/history", {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`Failed to add items to Trakt history: ${res.statusText}`);
    }
    return res.json();
  }

  async addRatings(payload: {
    movies?: { rating: number; rated_at?: string; ids: { trakt?: number; tmdb?: number; imdb?: string } }[];
    shows?: { rating: number; rated_at?: string; ids: { trakt?: number; tmdb?: number; tvdb?: number } }[];
  }) {
    const res = await fetch("https://api.trakt.tv/sync/ratings", {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`Failed to add ratings to Trakt: ${res.statusText}`);
    }
    return res.json();
  }

  async searchId(id: string, idType: 'tmdb' | 'imdb' | 'trakt', type: 'movie' | 'show' = 'movie'): Promise<any[]> {
    const endpoint = `https://api.trakt.tv/search/${idType}/${id}?type=${type}&extended=full`;
    const res = await fetch(endpoint, {
      headers: this.getHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      if (res.status === 404) return [];
      console.warn(`Trakt searchId failed (${res.status}) for ${idType}:${id}`);
      return [];
    }
    return res.json();
  }

  async searchMovie(
    title: string,
    year?: number
  ): Promise<{ movie: TraktMovieWatched["movie"] }[]> {
    const cleanTitle = encodeURIComponent(title.trim());
    const yearParam = year ? `&years=${year}` : "";
    const endpoint = `https://api.trakt.tv/search/movie?query=${cleanTitle}${yearParam}&extended=full`;

    const res = await fetch(endpoint, {
      headers: this.getHeaders(),
      cache: "no-store",
    });
    if (!res.ok) return [];
    return res.json();
  }
}
