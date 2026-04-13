// Supplement Cloudflare Env with secrets not captured by `wrangler types`
// (secrets cannot be declared in wrangler.toml and therefore are not auto-generated)
declare namespace Cloudflare {
  interface Env {
    SPOTIFY_CLIENT_ID: string;
    SPOTIFY_CLIENT_SECRET: string;
  }
}
