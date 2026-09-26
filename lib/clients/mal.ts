import crypto from "crypto";

export interface MalTokenResponse {
  token_type: string;
  expires_in: number;
  access_token: string;
  refresh_token: string;
}

export interface MalUser {
  id: number;
  name: string;
  picture?: string;
  joined_at: string;
}

export interface MalAnimeNode {
  id: number;
  title: string;
  main_picture?: {
    medium?: string;
    large?: string;
  };
  num_episodes?: number;
}

export interface MalListStatus {
  status: "watching" | "completed" | "on_hold" | "dropped" | "plan_to_watch";
  score: number; // 0-10
  num_episodes_watched: number;
  is_rewatching: boolean;
  updated_at: string;
}

export interface MalUserAnimeItem {
  node: MalAnimeNode;
  list_status: MalListStatus;
}

export class MalClient {
  private clientId: string;
  private clientSecret: string;
  private accessToken?: string;

  constructor(accessToken?: string) {
    this.clientId = process.env.MAL_CLIENT_ID || "";
    this.clientSecret = process.env.MAL_CLIENT_SECRET || "";
    this.accessToken = accessToken;
  }

  static generatePkceVerifier(): string {
    return crypto.randomBytes(32).toString("base64url");
  }

  static getAuthorizeUrl(
    redirectUri: string,
    codeVerifier: string,
    state?: string
  ): string {
    const clientId = process.env.MAL_CLIENT_ID || "";
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      code_challenge: codeVerifier,
      code_challenge_method: "plain",
      redirect_uri: redirectUri,
      state: state || "",
    });
    return `https://myanimelist.net/v1/oauth2/authorize?${params.toString()}`;
  }

  static async exchangeCodeForToken(
    code: string,
    codeVerifier: string,
    redirectUri: string
  ): Promise<MalTokenResponse> {
    const params = new URLSearchParams({
      client_id: process.env.MAL_CLIENT_ID || "",
      client_secret: process.env.MAL_CLIENT_SECRET || "",
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    });

    const res = await fetch("https://myanimelist.net/v1/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`MAL token exchange failed (${res.status}): ${err}`);
    }

    return res.json();
  }

  static async refreshAccessToken(
    refreshToken: string
  ): Promise<MalTokenResponse> {
    const params = new URLSearchParams({
      client_id: process.env.MAL_CLIENT_ID || "",
      client_secret: process.env.MAL_CLIENT_SECRET || "",
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });

    const res = await fetch("https://myanimelist.net/v1/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`MAL token refresh failed (${res.status}): ${err}`);
    }

    return res.json();
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }
    return headers;
  }

  async getCurrentUser(): Promise<MalUser> {
    const res = await fetch("https://api.myanimelist.net/v2/users/@me", {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch MAL user: ${res.statusText}`);
    }
    return res.json();
  }

  async getUserAnimeList(status?: string): Promise<MalUserAnimeItem[]> {
    const url = new URL("https://api.myanimelist.net/v2/users/@me/animelist");
    url.searchParams.set("limit", "1000");
    url.searchParams.set(
      "fields",
      "list_status{status,score,num_episodes_watched,is_rewatching,updated_at},num_episodes"
    );
    if (status) {
      url.searchParams.set("status", status);
    }

    const res = await fetch(url.toString(), {
      headers: this.getHeaders(),
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch MAL anime list: ${res.statusText}`);
    }

    const data = await res.json();
    return data.data || [];
  }

  async updateListStatus(
    animeId: number,
    params: {
      status?: "watching" | "completed" | "on_hold" | "dropped" | "plan_to_watch";
      score?: number; // 0-10
      num_watched_episodes?: number;
    }
  ): Promise<MalListStatus> {
    const body = new URLSearchParams();
    if (params.status) body.set("status", params.status);
    if (params.score !== undefined) body.set("score", params.score.toString());
    if (params.num_watched_episodes !== undefined) {
      body.set("num_watched_episodes", params.num_watched_episodes.toString());
    }

    const res = await fetch(
      `https://api.myanimelist.net/v2/anime/${animeId}/my_list_status`,
      {
        method: "PATCH",
        headers: {
          ...this.getHeaders(),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to update MAL anime ${animeId}: ${err}`);
    }

    return res.json();
  }

  async searchAnime(query: string): Promise<MalAnimeNode[]> {
    const url = new URL("https://api.myanimelist.net/v2/anime");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "5");

    const res = await fetch(url.toString(), {
      headers: this.getHeaders(),
    });

    if (!res.ok) return [];
    const data = await res.json();
    return data.data?.map((d: { node: MalAnimeNode }) => d.node) || [];
  }
}
