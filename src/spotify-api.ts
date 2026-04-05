import type { Env, SpotifyTokens } from "./types";

const SPOTIFY_API_BASE = "https://api.spotify.com/v1";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export class SpotifyApiError extends Error {
  constructor(
    public status: number,
    public body: string
  ) {
    super(`Spotify API error: ${status}`);
  }
}

function formatDuration(ms: number): string {
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000).toString().padStart(2, "0");
  return `${min}:${sec}`;
}

function artistNames(artists: SpotifyArtist[]): string {
  return artists.map((a) => a.name).join(", ");
}

async function spotifyFetch(
  token: string,
  path: string,
  options?: RequestInit
): Promise<Response> {
  const res = await fetch(`${SPOTIFY_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const errorBody = await res.text();
    throw new SpotifyApiError(res.status, errorBody);
  }
  return res;
}

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

export async function refreshAccessToken(
  env: Env,
  userId: string
): Promise<string> {
  const stored = await env.SPOTIFY_TOKENS.get<SpotifyTokens>(userId, "json");
  if (!stored?.refresh_token) {
    throw new Error("No refresh token available. Re-authorization required.");
  }

  const credentials = btoa(
    `${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`
  );
  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: stored.refresh_token,
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${errorBody}`);
  }

  const data: {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  } = await res.json();

  const updated: SpotifyTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? stored.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };

  await env.SPOTIFY_TOKENS.put(userId, JSON.stringify(updated));
  return updated.access_token;
}

export async function getValidToken(
  env: Env,
  userId: string
): Promise<string> {
  const stored = await env.SPOTIFY_TOKENS.get<SpotifyTokens>(userId, "json");
  if (!stored) {
    throw new Error("No Spotify tokens found. Re-authorization required.");
  }

  if (stored.expires_at - Date.now() < 5 * 60 * 1000) {
    return refreshAccessToken(env, userId);
  }
  return stored.access_token;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export async function search(
  token: string,
  query: string,
  type: string,
  limit: number
): Promise<SpotifySearchResult> {
  const params = new URLSearchParams({ q: query, type, limit: String(limit) });
  const res = await spotifyFetch(token, `/search?${params}`);
  return res.json();
}

export function formatSearchResults(
  data: SpotifySearchResult,
  type: string
): string {
  const lines: string[] = [];

  if (type === "track" && data.tracks) {
    for (const t of data.tracks.items) {
      lines.push(
        `${t.name} - ${artistNames(t.artists)} (${t.album.name}) [spotify:track:${t.id}]`
      );
    }
  }

  if (type === "album" && data.albums) {
    for (const a of data.albums.items) {
      const year = a.release_date?.substring(0, 4) ?? "Unknown";
      lines.push(`${a.name} - ${artistNames(a.artists)} (${year}) [spotify:album:${a.id}]`);
    }
  }

  if (type === "artist" && data.artists) {
    for (const a of data.artists.items) {
      const genres = a.genres?.length ? a.genres.join(", ") : "N/A";
      lines.push(`${a.name} (${genres}) [spotify:artist:${a.id}]`);
    }
  }

  if (type === "playlist" && data.playlists) {
    for (const p of data.playlists.items) {
      const owner = p.owner?.display_name ?? "Unknown";
      lines.push(
        `${p.name} by ${owner} (${p.tracks.total} tracks) [spotify:playlist:${p.id}]`
      );
    }
  }

  return lines.length > 0 ? lines.join("\n") : "No results found.";
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

export async function getCurrentTrack(
  token: string
): Promise<SpotifyCurrentTrack | null> {
  // 204/202 = no active playback; spotifyFetch would throw on these, so use raw fetch
  const res = await fetch(
    `${SPOTIFY_API_BASE}/me/player/currently-playing`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (res.status === 204 || res.status === 202) return null;
  if (!res.ok) {
    const errorBody = await res.text();
    throw new SpotifyApiError(res.status, errorBody);
  }
  return res.json();
}

export async function startPlayback(
  token: string,
  spotifyUri?: string
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (spotifyUri) {
    if (spotifyUri.includes(":track:")) {
      body.uris = [spotifyUri];
    } else {
      body.context_uri = spotifyUri;
    }
  }
  await spotifyFetch(token, "/me/player/play", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function pausePlayback(token: string): Promise<void> {
  await spotifyFetch(token, "/me/player/pause", { method: "PUT" });
}

export async function skipTrack(
  token: string,
  numSkips: number = 1
): Promise<void> {
  for (let i = 0; i < numSkips; i++) {
    await spotifyFetch(token, "/me/player/next", { method: "POST" });
  }
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

export async function addToQueue(
  token: string,
  uri: string
): Promise<void> {
  const params = new URLSearchParams({ uri });
  await spotifyFetch(token, `/me/player/queue?${params}`, { method: "POST" });
}

export async function getQueue(token: string): Promise<SpotifyQueue> {
  const res = await spotifyFetch(token, "/me/player/queue");
  return res.json();
}

// ---------------------------------------------------------------------------
// Get Info
// ---------------------------------------------------------------------------

export async function getTrackInfo(
  token: string,
  id: string
): Promise<SpotifyTrackDetail> {
  const res = await spotifyFetch(token, `/tracks/${id}`);
  return res.json();
}

export async function getAlbumInfo(
  token: string,
  id: string
): Promise<SpotifyAlbumDetail> {
  const res = await spotifyFetch(token, `/albums/${id}`);
  return res.json();
}

export async function getArtistInfo(
  token: string,
  id: string
): Promise<SpotifyArtistInfoResult> {
  const [artistRes, topTracksRes, albumsRes] = await Promise.all([
    spotifyFetch(token, `/artists/${id}`),
    spotifyFetch(token, `/artists/${id}/top-tracks`),
    spotifyFetch(token, `/artists/${id}/albums?limit=10`),
  ]);
  const artist = await artistRes.json() as SpotifyArtistDetail;
  const topTracks = await topTracksRes.json() as { tracks: SpotifyTrackDetail[] };
  const albums = await albumsRes.json() as { items: SpotifyAlbumDetail[] };
  return { ...artist, topTracks: topTracks.tracks, albums: albums.items };
}

export async function getPlaylistInfo(
  token: string,
  id: string
): Promise<SpotifyPlaylistDetail> {
  const res = await spotifyFetch(token, `/playlists/${id}`);
  return res.json();
}

export function formatItemInfo(type: string, data: unknown): string {
  if (type === "track") {
    const t = data as SpotifyTrackDetail;
    return [
      `Track: ${t.name}`,
      `Artists: ${artistNames(t.artists)}`,
      `Album: ${t.album.name}`,
      `Duration: ${formatDuration(t.duration_ms)}`,
      `Track Number: ${t.track_number}`,
      `URI: spotify:track:${t.id}`,
    ].join("\n");
  }

  if (type === "album") {
    const a = data as SpotifyAlbumDetail;
    const tracks = a.tracks?.items
      ?.map(
        (t: SpotifyTrackSimple, i: number) =>
          `  ${i + 1}. ${t.name} (${artistNames(t.artists)})`
      )
      .join("\n");
    return [
      `Album: ${a.name}`,
      `Artists: ${artistNames(a.artists)}`,
      `Release Date: ${a.release_date ?? "Unknown"}`,
      `Total Tracks: ${a.total_tracks}`,
      `Genres: ${a.genres?.join(", ") || "N/A"}`,
      `URI: spotify:album:${a.id}`,
      tracks ? `\nTracks:\n${tracks}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (type === "artist") {
    const a = data as SpotifyArtistInfoResult;
    const topTracks = a.topTracks
      ?.slice(0, 5)
      .map((t, i) => `  ${i + 1}. ${t.name} (${t.album.name})`)
      .join("\n");
    const albums = a.albums
      ?.slice(0, 5)
      .map((al, i) => `  ${i + 1}. ${al.name} (${al.release_date?.substring(0, 4) ?? "Unknown"})`)
      .join("\n");
    return [
      `Artist: ${a.name}`,
      `Genres: ${a.genres?.join(", ") || "N/A"}`,
      `Followers: ${a.followers?.total ?? "N/A"}`,
      `URI: spotify:artist:${a.id}`,
      topTracks ? `\nTop Tracks:\n${topTracks}` : "",
      albums ? `\nAlbums:\n${albums}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (type === "playlist") {
    const p = data as SpotifyPlaylistDetail;
    const tracks = p.tracks?.items
      ?.slice(0, 20)
      .map((item, i) => {
        const t = item.track;
        if (!t) return `  ${i + 1}. (unavailable)`;
        return `  ${i + 1}. ${t.name} - ${artistNames(t.artists)}`;
      })
      .join("\n");
    return [
      `Playlist: ${p.name}`,
      `Owner: ${p.owner?.display_name ?? "Unknown"}`,
      `Description: ${p.description || "N/A"}`,
      `Total Tracks: ${p.tracks?.total ?? 0}`,
      `URI: spotify:playlist:${p.id}`,
      tracks ? `\nTracks:\n${tracks}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return "Unknown item type.";
}

// ---------------------------------------------------------------------------
// Playlist management
// ---------------------------------------------------------------------------

export async function createPlaylist(
  token: string,
  userId: string,
  name: string,
  isPublic: boolean,
  description?: string
): Promise<SpotifyPlaylistDetail> {
  const res = await spotifyFetch(token, `/users/${userId}/playlists`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      public: isPublic,
      description: description ?? "",
    }),
  });
  return res.json();
}

export async function addTracksToPlaylist(
  token: string,
  playlistId: string,
  trackUris: string[],
  position?: number
): Promise<void> {
  const body: Record<string, unknown> = { uris: trackUris };
  if (position !== undefined) body.position = position;
  await spotifyFetch(token, `/playlists/${playlistId}/tracks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function addToLikedSongs(
  token: string,
  trackIds: string[]
): Promise<void> {
  await spotifyFetch(token, "/me/tracks", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: trackIds }),
  });
}

// ---------------------------------------------------------------------------
// User playlists (for search_my_playlists)
// ---------------------------------------------------------------------------

export async function getUserPlaylists(
  token: string,
  limit: number = 50,
  offset: number = 0
): Promise<SpotifyPaginatedPlaylists> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  const res = await spotifyFetch(token, `/me/playlists?${params}`);
  return res.json();
}

export async function searchMyPlaylists(
  token: string,
  query: string,
  limit: number = 10
): Promise<SpotifyPlaylistSimple[]> {
  const matched: SpotifyPlaylistSimple[] = [];
  let offset = 0;
  const pageSize = 50;
  const lowerQuery = query.toLowerCase();

  while (matched.length < limit) {
    const page = await getUserPlaylists(token, pageSize, offset);
    if (!page.items || page.items.length === 0) break;

    for (const p of page.items) {
      if (p.name.toLowerCase().includes(lowerQuery)) {
        matched.push(p);
        if (matched.length >= limit) break;
      }
    }

    if (!page.next) break;
    offset += pageSize;
  }

  return matched;
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

export function formatCurrentTrack(data: SpotifyCurrentTrack | null): string {
  if (!data || !data.item) return "No track is currently playing.";
  const t = data.item;
  const progress = data.progress_ms ? formatDuration(data.progress_ms) : "0:00";
  return [
    `Now Playing: ${t.name}`,
    `Artists: ${artistNames(t.artists)}`,
    `Album: ${t.album.name}`,
    `Progress: ${progress} / ${formatDuration(t.duration_ms)}`,
    `Playing: ${data.is_playing ? "Yes" : "Paused"}`,
    `URI: spotify:track:${t.id}`,
  ].join("\n");
}

export function formatQueue(data: SpotifyQueue): string {
  const lines: string[] = [];
  if (data.currently_playing) {
    const t = data.currently_playing;
    lines.push(`Now Playing: ${t.name} - ${t.artists ? artistNames(t.artists) : "Unknown"}`);
  }
  if (data.queue && data.queue.length > 0) {
    lines.push("\nQueue:");
    for (let i = 0; i < data.queue.length && i < 20; i++) {
      const t = data.queue[i];
      lines.push(`  ${i + 1}. ${t.name} - ${t.artists ? artistNames(t.artists) : "Unknown"}`);
    }
  } else if (lines.length === 0) {
    return "Queue is empty.";
  }
  return lines.join("\n");
}

export function formatPlaylistList(playlists: SpotifyPlaylistSimple[]): string {
  if (playlists.length === 0) return "No playlists found.";
  return playlists
    .map(
      (p) =>
        `${p.name} (${p.tracks.total} tracks) [spotify:playlist:${p.id}]`
    )
    .join("\n");
}

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

interface SpotifyArtist {
  id: string;
  name: string;
  genres?: string[];
}

interface SpotifySearchResult {
  tracks?: {
    items: Array<{
      id: string;
      name: string;
      artists: SpotifyArtist[];
      album: { name: string };
    }>;
  };
  albums?: {
    items: Array<{
      id: string;
      name: string;
      artists: SpotifyArtist[];
      release_date?: string;
    }>;
  };
  artists?: {
    items: SpotifyArtist[];
  };
  playlists?: {
    items: Array<{
      id: string;
      name: string;
      owner: { display_name?: string };
      tracks: { total: number };
    }>;
  };
}

interface SpotifyCurrentTrack {
  is_playing: boolean;
  progress_ms?: number;
  item: {
    id: string;
    name: string;
    artists: SpotifyArtist[];
    album: { name: string };
    duration_ms: number;
  };
}

interface SpotifyQueue {
  currently_playing: {
    id: string;
    name: string;
    artists?: SpotifyArtist[];
  } | null;
  queue: Array<{
    id: string;
    name: string;
    artists?: SpotifyArtist[];
  }>;
}

interface SpotifyTrackSimple {
  id: string;
  name: string;
  artists: SpotifyArtist[];
  duration_ms: number;
  track_number: number;
}

interface SpotifyTrackDetail {
  id: string;
  name: string;
  artists: SpotifyArtist[];
  album: { name: string; id: string };
  duration_ms: number;
  track_number: number;
  is_playable?: boolean;
}

interface SpotifyAlbumDetail {
  id: string;
  name: string;
  artists: SpotifyArtist[];
  release_date?: string;
  total_tracks: number;
  genres?: string[];
  tracks?: { items: SpotifyTrackSimple[] };
}

interface SpotifyArtistDetail {
  id: string;
  name: string;
  genres?: string[];
  followers?: { total: number };
}

interface SpotifyArtistInfoResult extends SpotifyArtistDetail {
  topTracks: SpotifyTrackDetail[];
  albums: SpotifyAlbumDetail[];
}

interface SpotifyPlaylistDetail {
  id: string;
  name: string;
  description?: string;
  owner?: { display_name?: string };
  tracks?: {
    total: number;
    items: Array<{
      track: {
        id: string;
        name: string;
        artists: SpotifyArtist[];
      } | null;
    }>;
  };
}

interface SpotifyPlaylistSimple {
  id: string;
  name: string;
  owner: { display_name?: string };
  tracks: { total: number };
}

interface SpotifyPaginatedPlaylists {
  items: SpotifyPlaylistSimple[];
  next: string | null;
  total: number;
}
