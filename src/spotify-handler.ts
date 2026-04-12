import { Hono } from "hono";
import type { Env, OAuthReqInfo, SpotifyTokens } from "./types";

const SPOTIFY_AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_USERINFO_URL = "https://api.spotify.com/v1/me";
const SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-private",
  "playlist-modify-public",
  "user-library-modify",
  "user-library-read",
].join(" ");

type HonoEnv = { Bindings: Env };

const app = new Hono<HonoEnv>();

app.get("/authorize", async (c) => {
  const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  if (!oauthReqInfo.clientId) {
    return c.text("Invalid OAuth request", 400);
  }

  // Store MCP OAuth request info in KV, keyed by a random state
  const stateKey = crypto.randomUUID();
  await c.env.OAUTH_KV.put(
    `spotify_state:${stateKey}`,
    JSON.stringify(oauthReqInfo),
    { expirationTtl: 600 }, // 10 minutes
  );

  // Use X-Forwarded-Host or Host header to get the correct origin behind tunnels/proxies
  const forwardedHost =
    c.req.header("x-forwarded-host") || c.req.header("host");
  const forwardedProto = c.req.header("x-forwarded-proto") || "https";
  const origin = forwardedHost
    ? `${forwardedProto}://${forwardedHost}`
    : new URL(c.req.url).origin;
  const params = new URLSearchParams({
    client_id: c.env.SPOTIFY_CLIENT_ID,
    response_type: "code",
    redirect_uri: `${origin}/callback`,
    scope: SCOPES,
    state: stateKey,
  });
  console.log("Redirect URI:", `${origin}/callback`);

  return c.redirect(`${SPOTIFY_AUTHORIZE_URL}?${params}`);
});

app.get("/callback", async (c) => {
  const code = c.req.query("code");
  const stateKey = c.req.query("state");
  const error = c.req.query("error");

  if (error) {
    return c.text(`Spotify authorization denied: ${error}`, 403);
  }
  if (!code || !stateKey) {
    return c.text("Missing code or state parameter", 400);
  }

  // Retrieve MCP OAuth request info
  const stored = await c.env.OAUTH_KV.get(`spotify_state:${stateKey}`);
  if (!stored) {
    return c.text("Invalid or expired state", 400);
  }
  const oauthReqInfo: OAuthReqInfo = JSON.parse(stored);
  await c.env.OAUTH_KV.delete(`spotify_state:${stateKey}`);

  // Exchange code for Spotify tokens
  const forwardedHost =
    c.req.header("x-forwarded-host") || c.req.header("host");
  const forwardedProto = c.req.header("x-forwarded-proto") || "https";
  const origin = forwardedHost
    ? `${forwardedProto}://${forwardedHost}`
    : new URL(c.req.url).origin;
  const credentials = btoa(
    `${c.env.SPOTIFY_CLIENT_ID}:${c.env.SPOTIFY_CLIENT_SECRET}`,
  );
  const tokenRes = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${origin}/callback`,
    }),
  });

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text();
    return c.text(`Token exchange failed: ${errBody}`, 500);
  }

  const tokenData: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  } = await tokenRes.json();

  // Get Spotify user ID
  const userRes = await fetch(SPOTIFY_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  if (!userRes.ok) {
    return c.text("Failed to fetch Spotify user info", 500);
  }
  const userData: { id: string; display_name?: string } = await userRes.json();

  // Save Spotify tokens to KV
  const spotifyTokens: SpotifyTokens = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_at: Date.now() + tokenData.expires_in * 1000,
  };
  await c.env.SPOTIFY_TOKENS.put(userData.id, JSON.stringify(spotifyTokens));

  // Complete MCP OAuth flow, passing userId as props
  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReqInfo,
    userId: userData.id,
    metadata: { label: userData.display_name ?? userData.id },
    scope: oauthReqInfo.scope,
    props: { userId: userData.id },
  });

  return c.redirect(redirectTo);
});

// Simple home page
app.get("/", (c) => {
  return c.text("Spotify MCP Server - Connect via MCP client at /mcp");
});

export const SpotifyHandler = app;
