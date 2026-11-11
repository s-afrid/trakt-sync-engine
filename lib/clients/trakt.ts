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
  ids: { slug: string };
  images?: { avatar?: { full?: string } };
}

export interface TraktMovieWatched {
  plays: number;
  last_watched_at: string;
  last_updated_at: string;
  movie: {
    title: string;
    year: number;
    ids: { trakt: number; slug: string; imdb?: string; tmdb?: number };
  };
}

const API = "https://api.trakt.tv";

export class TraktClient {
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
      "trakt-api-key": (process.env.TRAKT_CLIENT_ID || "").trim(),
      "User-Agent": "TraktLetterboxdSync/1.0",
    };
    if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;
    return headers;
  }

  static getAuthorizeUrl(redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: (process.env.TRAKT_CLIENT_ID || "").trim(),
      redirect_uri: redirectUri,
      state,
    });
    return `https://trakt.tv/oauth/authorize?${params.toString()}`;
  }

  static async exchangeCodeForToken(code: string, redirectUri: string): Promise<TraktTokenResponse> {
    return this.requestToken({
      code,
      client_id: process.env.TRAKT_CLIENT_ID,
      client_secret: process.env.TRAKT_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
  }

  static async refreshAccessToken(refreshToken: string, redirectUri: string): Promise<TraktTokenResponse> {
    return this.requestToken({
      refresh_token: refreshToken,
      client_id: process.env.TRAKT_CLIENT_ID,
      client_secret: process.env.TRAKT_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "refresh_token",
    });
  }

  private static async requestToken(body: Record<string, string | undefined>): Promise<TraktTokenResponse> {
    const response = await fetch(`${API}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Trakt token request failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
    return response.json();
  }

  async getCurrentUser(): Promise<TraktUser> {
    const endpoint = this.accessToken
      ? `${API}/users/me?extended=full`
      : `${API}/users/${encodeURIComponent(this.username || "")}?extended=full`;
    const response = await fetch(endpoint, { headers: this.getHeaders(), cache: "no-store" });
    if (!response.ok) throw new Error(`Failed to fetch Trakt user (${response.status}).`);
    return response.json();
  }

  async getWatchedMovies(): Promise<TraktMovieWatched[]> {
    const endpoint = this.accessToken
      ? `${API}/sync/watched/movies?extended=full`
      : `${API}/users/${encodeURIComponent(this.username || "")}/watched/movies?extended=full`;
    const historyEndpoint = this.accessToken
      ? `${API}/sync/history/movies?limit=100`
      : `${API}/users/${encodeURIComponent(this.username || "")}/history/movies?limit=100`;
    const [watchedResponse, historyResponse] = await Promise.all([
      fetch(endpoint, { headers: this.getHeaders(), cache: "no-store" }),
      fetch(historyEndpoint, { headers: this.getHeaders(), cache: "no-store" }).catch(() => null),
    ]);
    if (!watchedResponse.ok) {
      const authHint = watchedResponse.status === 401 || watchedResponse.status === 403
        ? " The profile may be private; connect it with Trakt OAuth."
        : "";
      throw new Error(`Failed to fetch Trakt watched movies (${watchedResponse.status}).${authHint}`);
    }

    const watched = await watchedResponse.json() as TraktMovieWatched[];
    const history = historyResponse?.ok
      ? await historyResponse.json() as Array<{ watched_at: string; movie: TraktMovieWatched["movie"] }>
      : [];
    const byTraktId = new Map<number, TraktMovieWatched>();
    for (const item of watched) {
      if (item.movie?.ids?.trakt) byTraktId.set(item.movie.ids.trakt, item);
    }
    for (const item of history) {
      const traktId = item.movie?.ids?.trakt;
      if (!traktId) continue;
      const existing = byTraktId.get(traktId);
      if (!existing) {
        byTraktId.set(traktId, { plays: 1, last_watched_at: item.watched_at, last_updated_at: item.watched_at, movie: item.movie });
      } else if (new Date(item.watched_at).getTime() > new Date(existing.last_watched_at).getTime()) {
        existing.last_watched_at = item.watched_at;
        existing.last_updated_at = item.watched_at;
      }
    }
    return [...byTraktId.values()];
  }
}
