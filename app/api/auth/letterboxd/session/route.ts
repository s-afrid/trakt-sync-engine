import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { linkedAccounts } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import fs from "fs";
import path from "path";

interface RawCookieItem {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  expirationDate?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
}

interface PlaywrightCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

function normalizeSameSite(val?: string): "Strict" | "Lax" | "None" {
  if (!val) return "Lax";
  const lower = val.toLowerCase();
  if (lower === "strict") return "Strict";
  if (lower === "none" || lower === "no_restriction") return "None";
  return "Lax";
}

function transformToPlaywrightSession(rawInput: unknown): {
  cookies: PlaywrightCookie[];
  origins: { origin: string; localStorage: { name: string; value: string }[] }[];
} {
  let cookieList: RawCookieItem[] = [];

  // Case 1: string input
  if (typeof rawInput === "string") {
    const trimmed = rawInput.trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        return transformToPlaywrightSession(parsed);
      } catch (err) {
        throw new Error("Invalid JSON format provided. Please check the pasted cookie text.");
      }
    } else {
      // Key=value; key=value string
      const pairs = trimmed.split(";");
      for (const pair of pairs) {
        const [k, ...v] = pair.split("=");
        if (k && v.length > 0) {
          cookieList.push({
            name: k.trim(),
            value: v.join("=").trim(),
            domain: ".letterboxd.com",
            path: "/",
            httpOnly: k.trim().includes("user"),
            secure: true,
          });
        }
      }
    }
  } else if (Array.isArray(rawInput)) {
    // Case 2: Array from Cookie-Editor / EditThisCookie
    cookieList = rawInput as RawCookieItem[];
  } else if (typeof rawInput === "object" && rawInput !== null) {
    // Case 3: Already Playwright format
    const obj = rawInput as { cookies?: RawCookieItem[]; origins?: unknown[] };
    if (Array.isArray(obj.cookies)) {
      cookieList = obj.cookies;
    } else {
      throw new Error("Object does not contain a 'cookies' array.");
    }
  } else {
    throw new Error("Unrecognized cookie input format.");
  }

  if (cookieList.length === 0) {
    throw new Error("No cookies found in the provided input.");
  }

  const defaultExpiry = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60; // 1 year fallback

  const cookies: PlaywrightCookie[] = cookieList
    .filter((c) => c && typeof c.name === "string" && typeof c.value === "string")
    .map((c) => {
      let domain = c.domain || ".letterboxd.com";
      if (!domain.includes("letterboxd.com")) {
        domain = ".letterboxd.com";
      }

      const expires =
        typeof c.expires === "number" && c.expires > 0
          ? c.expires
          : typeof c.expirationDate === "number" && c.expirationDate > 0
          ? Math.floor(c.expirationDate)
          : defaultExpiry;

      return {
        name: c.name,
        value: c.value,
        domain,
        path: c.path || "/",
        expires,
        httpOnly: c.httpOnly ?? (c.name === "letterboxd.user" || c.name.startsWith("__Host")),
        secure: c.secure ?? true,
        sameSite: normalizeSameSite(c.sameSite),
      };
    });

  return {
    cookies,
    origins: [
      {
        origin: "https://letterboxd.com",
        localStorage: [],
      },
    ],
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const includePayload = searchParams.get("includePayload") === "true";

    let sessionData: { cookies?: PlaywrightCookie[] } | null = null;
    let updatedAt: string | null = null;

    // Check DB first
    if (db) {
      try {
        const acc = await db
          .select()
          .from(linkedAccounts)
          .where(eq(linkedAccounts.provider, "letterboxd"))
          .limit(1);

        if (acc.length > 0 && acc[0].metadata) {
          const meta = JSON.parse(acc[0].metadata);
          if (meta.session && Array.isArray(meta.session.cookies)) {
            sessionData = meta.session;
            updatedAt = meta.updatedAt || acc[0].updatedAt.toISOString();
          }
        }
      } catch (err) {
        console.warn("DB session lookup error:", err);
      }
    }

    // Fallback to local disk file
    if (!sessionData) {
      try {
        const localPath = path.join(process.cwd(), ".letterboxd_session.json");
        if (fs.existsSync(localPath)) {
          const content = fs.readFileSync(localPath, "utf-8");
          sessionData = JSON.parse(content);
          const stat = fs.statSync(localPath);
          updatedAt = stat.mtime.toISOString();
        }
      } catch {}
    }

    if (!sessionData || !sessionData.cookies) {
      return NextResponse.json({
        hasSession: false,
        cookieCount: 0,
        message: "No saved Letterboxd session found.",
      });
    }

    const userCookie = sessionData.cookies.find(
      (c) => c.name === "letterboxd.user" || c.name === "com.letterboxd.signed"
    );

    let expiresDate: string | null = null;
    let isExpired = false;
    if (userCookie && typeof userCookie.expires === "number") {
      const exp = new Date(userCookie.expires * 1000);
      expiresDate = exp.toISOString();
      isExpired = exp.getTime() < Date.now();
    }

    return NextResponse.json({
      hasSession: true,
      cookieCount: sessionData.cookies.length,
      hasUserCookie: !!userCookie,
      isExpired,
      expiresAt: expiresDate,
      updatedAt,
      sessionJson: includePayload ? JSON.stringify(sessionData) : undefined,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rawCookies = body.cookies || body.session || body.raw;

    if (!rawCookies) {
      return NextResponse.json(
        { error: "Missing cookie content. Please paste the exported JSON from your cookie extension." },
        { status: 400 }
      );
    }

    const session = transformToPlaywrightSession(rawCookies);

    const userCookie = session.cookies.find(
      (c) => c.name === "letterboxd.user" || c.name === "com.letterboxd.signed"
    );

    let expiresDate: string | null = null;
    if (userCookie && typeof userCookie.expires === "number") {
      expiresDate = new Date(userCookie.expires * 1000).toISOString();
    }

    const sessionPayloadString = JSON.stringify(session);
    const nowIso = new Date().toISOString();

    // 1. Write to local file if running with filesystem access
    try {
      const localPath = path.join(process.cwd(), ".letterboxd_session.json");
      fs.writeFileSync(localPath, sessionPayloadString, "utf-8");
    } catch {}

    // 2. Persist to Neon Postgres DB
    if (db) {
      try {
        const existing = await db
          .select()
          .from(linkedAccounts)
          .where(eq(linkedAccounts.provider, "letterboxd"))
          .limit(1);

        const metadataString = JSON.stringify({
          session,
          updatedAt: nowIso,
          cookieCount: session.cookies.length,
          expiresAt: expiresDate,
        });

        if (existing.length > 0) {
          await db
            .update(linkedAccounts)
            .set({
              metadata: metadataString,
              updatedAt: new Date(),
            })
            .where(eq(linkedAccounts.id, existing[0].id));
        } else {
          await db.insert(linkedAccounts).values({
            id: `lb_${Date.now()}`,
            userId: "default_user",
            provider: "letterboxd",
            providerUsername: "Af_Sindbad",
            metadata: metadataString,
          });
        }
      } catch (dbErr) {
        console.warn("DB session save error:", dbErr);
      }
    }

    return NextResponse.json({
      success: true,
      message: "Letterboxd session saved successfully!",
      cookieCount: session.cookies.length,
      hasUserCookie: !!userCookie,
      expiresAt: expiresDate,
      gitHubSecretPayload: sessionPayloadString,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
