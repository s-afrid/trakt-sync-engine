import { NextRequest, NextResponse } from "next/server";
import { TraktClient } from "@/lib/clients/trakt";
import { randomBytes } from "node:crypto";

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const redirectUri =
    process.env.TRAKT_REDIRECT_URI || `${origin}/api/auth/trakt/callback`;
  const state = randomBytes(24).toString("hex");
  const response = NextResponse.redirect(TraktClient.getAuthorizeUrl(redirectUri, state));
  response.cookies.set("trakt_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/api/auth/trakt/callback",
  });
  return response;
}
