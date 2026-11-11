import { XMLParser } from "fast-xml-parser";

export class LetterboxdClient {
  static async fetchUserProfile(username: string): Promise<{ username: string; displayName?: string; avatar?: string }> {
    const cleanUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,32}$/.test(cleanUsername)) throw new Error("Enter a valid Letterboxd username.");
    const response = await fetch(`https://letterboxd.com/${encodeURIComponent(cleanUsername)}/rss/`, {
      headers: { "User-Agent": "TraktLetterboxdSync/1.0" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Could not verify Letterboxd username (HTTP ${response.status}).`);
    const parser = new XMLParser({ ignoreAttributes: false });
    const parsed = parser.parse(await response.text());
    const channel = parsed?.rss?.channel;
    const title = channel?.title;
    const displayName = typeof title === "string" && title.startsWith("Letterboxd - ")
      ? title.replace(/^Letterboxd\s*-\s*/, "").trim()
      : cleanUsername;
    const avatar = typeof channel?.image?.url === "string" ? channel.image.url : undefined;
    return { username: cleanUsername, displayName, avatar };
  }
}
