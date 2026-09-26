import { NextRequest, NextResponse } from "next/server";
import { TraktClient } from "@/lib/clients/trakt";

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const redirectUri =
    process.env.TRAKT_REDIRECT_URI || `${origin}/api/auth/trakt/callback`;
  const url = TraktClient.getAuthorizeUrl(redirectUri);

  return NextResponse.redirect(url);
}
