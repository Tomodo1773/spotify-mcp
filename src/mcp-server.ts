import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  search,
  formatSearchResults,
  getCurrentTrack,
  formatCurrentTrack,
  startPlayback,
  pausePlayback,
  skipTrack,
  addToQueue,
  getQueue,
  formatQueue,
  getTrackInfo,
  getAlbumInfo,
  getArtistInfo,
  getPlaylistInfo,
  formatItemInfo,
  createPlaylist,
  addTracksToPlaylist,
  addToLikedSongs,
  searchMyPlaylists,
  formatPlaylistList,
  getValidToken,
  refreshAccessToken,
  SpotifyApiError,
} from "./spotify-api";
import type { Env, SpotifyAuthProps } from "./types";

type McpTextResult = { content: Array<{ type: "text"; text: string }> };

export class SpotifyMcpServer extends McpAgent<Env, unknown, SpotifyAuthProps> {
  server = new McpServer({
    name: "Spotify",
    version: "1.0.0",
  });

  private async withAuth<T>(
    fn: (token: string) => Promise<T>
  ): Promise<T> {
    const userId = this.props?.userId;
    if (!userId) {
      throw new Error(
        "Not authenticated. Please reconnect to authorize with Spotify."
      );
    }

    let token = await getValidToken(this.env, userId);
    try {
      return await fn(token);
    } catch (err) {
      if (err instanceof SpotifyApiError && err.status === 401) {
        token = await refreshAccessToken(this.env, userId);
        return await fn(token);
      }
      throw err;
    }
  }

  private async handleTool(
    fn: (token: string) => Promise<string>
  ): Promise<McpTextResult> {
    try {
      const text = await this.withAuth(fn);
      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error occurred";
      return { content: [{ type: "text" as const, text: `Error: ${message}` }] };
    }
  }

  async init() {
    // ----- spotify_search -----
    this.server.tool(
      "spotify_search",
      "Search Spotify for tracks, albums, artists, or playlists",
      {
        query: z.string().describe("Search query"),
        type: z
          .enum(["track", "album", "artist", "playlist"])
          .default("track")
          .describe("Type of content to search for"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(10)
          .default(5)
          .describe("Number of results (max 10)"),
      },
      async ({ query, type, limit }) =>
        this.handleTool(async (token) => {
          const result = await search(token, query, type, limit);
          return formatSearchResults(result, type);
        })
    );

    // ----- spotify_playback -----
    this.server.tool(
      "spotify_playback",
      "Control Spotify playback: get current track, start, pause, or skip",
      {
        action: z
          .enum(["get", "start", "pause", "skip"])
          .describe("Action to perform"),
        spotify_uri: z
          .string()
          .optional()
          .describe(
            "Spotify URI to play (e.g. spotify:track:xxx). Used with 'start' action."
          ),
        num_skips: z
          .number()
          .int()
          .min(1)
          .max(10)
          .default(1)
          .describe("Number of tracks to skip. Used with 'skip' action."),
      },
      async ({ action, spotify_uri, num_skips }) =>
        this.handleTool(async (token) => {
          switch (action) {
            case "get": {
              const track = await getCurrentTrack(token);
              return formatCurrentTrack(track);
            }
            case "start":
              await startPlayback(token, spotify_uri);
              return spotify_uri
                ? `Started playback: ${spotify_uri}`
                : "Resumed playback.";
            case "pause":
              await pausePlayback(token);
              return "Playback paused.";
            case "skip":
              await skipTrack(token, num_skips);
              return `Skipped ${num_skips} track(s).`;
          }
        })
    );

    // ----- spotify_queue -----
    this.server.tool(
      "spotify_queue",
      "Manage the Spotify playback queue: add a track or view the current queue",
      {
        action: z.enum(["add", "get"]).describe("Action to perform"),
        track_uri: z
          .string()
          .optional()
          .describe(
            "Spotify URI of the track to add (e.g. spotify:track:xxx). Required for 'add' action."
          ),
      },
      async ({ action, track_uri }) =>
        this.handleTool(async (token) => {
          if (action === "add") {
            if (!track_uri) {
              return "Error: track_uri is required for 'add' action.";
            }
            await addToQueue(token, track_uri);
            return `Added to queue: ${track_uri}`;
          }
          const queue = await getQueue(token);
          return formatQueue(queue);
        })
    );

    // ----- spotify_get_info -----
    this.server.tool(
      "spotify_get_info",
      "Get detailed information about a Spotify item (track, album, artist, or playlist)",
      {
        item_uri: z
          .string()
          .describe(
            "Spotify URI (e.g. spotify:track:xxx, spotify:album:xxx, spotify:artist:xxx, spotify:playlist:xxx)"
          ),
      },
      async ({ item_uri }) =>
        this.handleTool(async (token) => {
          const parts = item_uri.split(":");
          if (parts.length < 3 || parts[0] !== "spotify") {
            return "Error: Invalid Spotify URI format. Expected spotify:{type}:{id}";
          }
          const type = parts[1];
          const id = parts[2];

          switch (type) {
            case "track": {
              const data = await getTrackInfo(token, id);
              return formatItemInfo("track", data);
            }
            case "album": {
              const data = await getAlbumInfo(token, id);
              return formatItemInfo("album", data);
            }
            case "artist": {
              const data = await getArtistInfo(token, id);
              return formatItemInfo("artist", data);
            }
            case "playlist": {
              const data = await getPlaylistInfo(token, id);
              return formatItemInfo("playlist", data);
            }
            default:
              return `Error: Unsupported item type '${type}'. Supported: track, album, artist, playlist`;
          }
        })
    );

    // ----- spotify_create_playlist -----
    this.server.tool(
      "spotify_create_playlist",
      "Create a new Spotify playlist",
      {
        name: z.string().describe("Name of the playlist"),
        public: z
          .boolean()
          .default(false)
          .describe("Whether the playlist should be public"),
        description: z
          .string()
          .optional()
          .describe("Description for the playlist"),
      },
      async ({ name, public: isPublic, description }) =>
        this.handleTool(async (token) => {
          const userId = this.props!.userId;
          const playlist = await createPlaylist(
            token,
            userId,
            name,
            isPublic,
            description
          );
          return `Playlist created: ${playlist.name} [spotify:playlist:${playlist.id}]`;
        })
    );

    // ----- spotify_add_tracks_to_playlist -----
    this.server.tool(
      "spotify_add_tracks_to_playlist",
      "Add a track to a Spotify playlist",
      {
        playlist_id: z.string().describe("ID of the playlist"),
        track_id: z.string().describe("ID of the track to add"),
        position: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Position to insert the track (0-based). Defaults to end."),
      },
      async ({ playlist_id, track_id, position }) =>
        this.handleTool(async (token) => {
          const trackUri = `spotify:track:${track_id}`;
          await addTracksToPlaylist(token, playlist_id, [trackUri], position);
          return `Track ${track_id} added to playlist ${playlist_id}.`;
        })
    );

    // ----- spotify_add_track_to_liked_songs -----
    this.server.tool(
      "spotify_add_track_to_liked_songs",
      "Add a track to the user's Liked Songs library",
      {
        track_id: z.string().describe("ID of the track to add to Liked Songs"),
      },
      async ({ track_id }) =>
        this.handleTool(async (token) => {
          await addToLikedSongs(token, [track_id]);
          return `Track ${track_id} added to Liked Songs.`;
        })
    );

    // ----- spotify_search_my_playlists -----
    this.server.tool(
      "spotify_search_my_playlists",
      "Search through your own Spotify playlists by name",
      {
        query: z.string().describe("Search query to match against playlist names"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(10)
          .describe("Maximum number of results to return"),
      },
      async ({ query, limit }) =>
        this.handleTool(async (token) => {
          const playlists = await searchMyPlaylists(token, query, limit);
          return formatPlaylistList(playlists);
        })
    );

    // ----- get_current_anime_playlist -----
    this.server.tool(
      "get_current_anime_playlist",
      "Get the current anime season playlist name based on the current date (JST)",
      {},
      async () => {
        const now = new Date(
          Date.now() + 9 * 60 * 60 * 1000 // UTC -> JST
        );
        const year = now.getUTCFullYear();
        const month = now.getUTCMonth() + 1; // 1-12

        let season: string;
        if (month >= 1 && month <= 3) {
          season = "冬";
        } else if (month >= 4 && month <= 6) {
          season = "春";
        } else if (month >= 7 && month <= 9) {
          season = "夏";
        } else {
          season = "秋";
        }

        const playlistName = `${year}${season}アニメ`;
        return {
          content: [{ type: "text" as const, text: playlistName }],
        };
      }
    );
  }
}
