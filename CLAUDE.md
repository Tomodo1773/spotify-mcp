# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

Cloudflare Workers上で動作するMCPサーバーのモノレポ。各サーバーはOAuth認証付きのリモートMCPサーバーとして動作する。

- `apps/spotify` — Spotify操作用MCPサーバー（再生制御、検索、プレイリスト管理）
- `apps/gemini` — Gemini API活用MCPサーバー（URL要約、YouTube文字起こし、画像生成）

## 開発コマンド

```bash
# 開発サーバー起動
pnpm dev:spotify          # port 8000
pnpm dev:gemini           # port 8788

# デプロイ
pnpm deploy:spotify
pnpm deploy:gemini

# リント・フォーマット
pnpm lint                 # biome check
pnpm lint:fix             # biome check --write
pnpm format               # biome format --write

# 型チェック
pnpm typecheck            # 全パッケージ
pnpm --filter @mcp-servers/spotify typecheck  # 個別

# Cloudflare型生成（geminiのみ）
pnpm --filter @mcp-servers/gemini cf-typegen
```

## 技術スタック

- **パッケージマネージャ**: pnpm（ワークスペース: `apps/*`）
- **ランタイム**: Cloudflare Workers
- **MCPフレームワーク**: `@modelcontextprotocol/sdk` + `agents`パッケージの`createMcpHandler`
- **OAuth**: `@cloudflare/workers-oauth-provider`
- **ルーティング**: Hono（OAuth defaultHandler用）
- **バリデーション**: Zod
- **リンター/フォーマッター**: Biome（インデント: スペース2、クォート: ダブル）

## アーキテクチャ

各MCPサーバーは共通のパターンに従う:

1. **`index.ts`** — エントリポイント。`OAuthProvider`を構成し、`apiHandler`（MCP）と`defaultHandler`（Hono OAuth flow）を接続。Cloudflare Tunnel対応のプロトコル書き換え処理を含む。
2. **MCP handler** — `McpServer`インスタンスにツールを登録し、`createMcpHandler`でハンドラ化。リクエストごとにサーバーを生成する関数パターン。
3. **OAuth handler** — Honoアプリとして実装。外部OAuthプロバイダ（Spotify/GitHub）との認証フローを処理。

MCPエンドポイントは`/mcp`、OAuthエンドポイントは`/authorize`、`/token`、`/register`。

## コミットメッセージ

日本語で簡潔に書く。
