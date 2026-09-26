import { NextRequest, NextResponse } from "next/server";
import { MalClient } from "@/lib/clients/mal";

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const redirectUri =
    process.env.MAL_REDIRECT_URI || `${origin}/api/auth/mal/callback`;

  // Generate PKCE verifier
  const codeVerifier = MalClient.generatePkceVerifier();
  const url = MalClient.getAuthorizeUrl(redirectUri, codeVerifier);

  const response = NextResponse.redirect(url);
  // Store code verifier in cookie for callback verification
  response.cookies.set("mal_pkce_verifier", codeVerifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 600, // 10 minutes
    path: "/",
  });

  return response;
}
