# mcp-servers

Cloudflare Workers 上で動作する MCP（Model Context Protocol）サーバーのモノレポ。各サーバーは OAuth 認証付きのリモート MCP サーバーとして動作する。

## アプリ一覧

### `apps/spotify` — Spotify MCP Server

Spotify OAuth で認証し、再生制御・検索・プレイリスト管理を行う。

| ツール | 説明 |
|--------|------|
| `spotify_search` | トラック・アルバム・アーティストを検索 |
| `spotify_playback` | 再生制御（現在の曲取得 / 再生 / 一時停止 / スキップ） |
| `spotify_queue` | キュー管理（追加 / 取得） |
| `spotify_get_info` | トラック・アルバム・アーティスト・プレイリストの詳細取得 |
| `spotify_create_playlist` | プライベートプレイリスト作成 |
| `spotify_add_tracks_to_playlist` | 自分のプレイリストにトラックを追加 |
| `spotify_add_track_to_liked_songs` | いいね！した曲に追加 |
| `spotify_search_my_playlists` | 自分のプレイリストを名前で検索 |
| `get_current_anime_playlist` | 現在のアニメシーズンのプレイリスト名を取得（JST） |

### `apps/gemini` — Gemini MCP Server

GitHub OAuth で認証し、Gemini API を活用した情報取得・生成を行う。

| ツール | 説明 |
|--------|------|
| `fetch_url` | 指定 URL の内容を Gemini が取得し日本語で要約 |
| `transcribe_youtube` | YouTube 動画を Gemini が文字起こし |
| `generate_image` | テキストから画像を生成し R2 に保存して URL を返す |

## 開発

```bash
# 依存関係インストール
pnpm install

# 開発サーバー起動
pnpm dev:spotify   # http://localhost:8000
pnpm dev:gemini    # http://localhost:8788

# リント（フォーマットチェックを含む）
pnpm lint
pnpm lint:fix      # 自動修正

# 型チェック
pnpm typecheck

# デプロイ
pnpm deploy:spotify
pnpm deploy:gemini
```

## セットアップ

### Spotify

Cloudflare Workers の環境変数・シークレット:

| 名前 | 種別 | 説明 |
|------|------|------|
| `SPOTIFY_CLIENT_ID` | Secret | Spotify アプリのクライアント ID |
| `SPOTIFY_CLIENT_SECRET` | Secret | Spotify アプリのクライアントシークレット |
| `COOKIE_ENCRYPTION_KEY` | Secret | Cookie 暗号化キー |
| `OAUTH_KV` | KV | OAuth セッション用 KV |
| `SPOTIFY_TOKENS` | KV | Spotify トークン保存用 KV |

### Gemini

Cloudflare Workers の環境変数・シークレット:

| 名前 | 種別 | 説明 |
|------|------|------|
| `GEMINI_API_KEY` | Secret | Google Gemini API キー |
| `GITHUB_CLIENT_ID` | Secret | GitHub OAuth アプリのクライアント ID |
| `GITHUB_CLIENT_SECRET` | Secret | GitHub OAuth アプリのクライアントシークレット |
| `COOKIE_ENCRYPTION_KEY` | Secret | Cookie 暗号化キー |
| `OAUTH_KV` | KV | OAuth セッション用 KV |
| `IMAGES` | R2 | 生成画像の保存先 R2 バケット |

## CI / Dependabot

- **CI**（`.github/workflows/ci.yml`）: PR・`main` への push 時に lint と型チェックを実行
- **Dependabot**（`.github/dependabot.yml`）: npm パッケージと GitHub Actions を週次（月曜）で更新。クールダウン設定あり（patch: 3日・minor: 7日・major: 14日）。更新はグループ化して 1 PR にまとめる

## アーキテクチャ

```
index.ts
└── OAuthProvider
    ├── apiHandler  → McpServer（/mcp）
    └── defaultHandler → Hono（/authorize, /token, /register）
```

各アプリは `OAuthProvider` を中心に構成される。MCP クライアントは `/mcp` へ接続し、認証が必要な場合は OAuth フローへリダイレクトされる。

## 技術スタック

- **ランタイム**: Cloudflare Workers
- **パッケージマネージャ**: pnpm（ワークスペース）
- **MCP フレームワーク**: `@modelcontextprotocol/sdk` + `agents`
- **OAuth**: `@cloudflare/workers-oauth-provider`
- **ルーティング**: Hono
- **バリデーション**: Zod
- **リンター / フォーマッター**: Biome
