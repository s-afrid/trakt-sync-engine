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
  };
}

export interface TraktShowWatched {
  plays: number;
  last_watched_at: string;
  last_updated_at: string;
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

export class TraktClient {
  private clientId: string;
  private clientSecret: string;
  private accessToken?: string;

  constructor(accessToken?: string) {
    this.clientId = process.env.TRAKT_CLIENT_ID || "";
    this.clientSecret = process.env.TRAKT_CLIENT_SECRET || "";
    this.accessToken = accessToken;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "trakt-api-version": "2",
      "trakt-api-key": this.clientId,
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
    const res = await fetch("https://api.trakt.tv/users/me?extended=full", {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch Trakt user: ${res.statusText}`);
    }
    return res.json();
  }

  async getWatchedMovies(): Promise<TraktMovieWatched[]> {
    const res = await fetch("https://api.trakt.tv/sync/watched/movies?extended=full", {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch watched movies: ${res.statusText}`);
    }
    return res.json();
  }

  async getWatchedShows(): Promise<TraktShowWatched[]> {
    const res = await fetch("https://api.trakt.tv/sync/watched/shows?extended=full,noseasons", {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      // noseasons may not return seasons breakdown, let's request with seasons
      const fullRes = await fetch("https://api.trakt.tv/sync/watched/shows?extended=full", {
        headers: this.getHeaders(),
      });
      if (!fullRes.ok) {
        throw new Error(`Failed to fetch watched shows: ${fullRes.statusText}`);
      }
      return fullRes.json();
    }
    return res.json();
  }

  async getMovieRatings(): Promise<TraktRatingItem[]> {
    const res = await fetch("https://api.trakt.tv/sync/ratings/movies", {
      headers: this.getHeaders(),
    });
    if (!res.ok) return [];
    return res.json();
  }

  async getShowRatings(): Promise<TraktRatingItem[]> {
    const res = await fetch("https://api.trakt.tv/sync/ratings/shows", {
      headers: this.getHeaders(),
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
}
