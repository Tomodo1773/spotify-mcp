import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { GoogleGenAI } from "@google/genai";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler } from "agents/mcp";
import { z } from "zod";
import { fetchUrlSummary, generateImage, transcribeYoutube } from "./gemini";
import { GitHubHandler } from "./github-handler";

function registerTools(server: McpServer, env: Env): void {
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

  server.tool(
    "fetch_url",
    "指定した URL の内容を Gemini が取得し、日本語で要約します。",
    { url: z.string().url().describe("要約したいページの URL") },
    async ({ url }) => {
      const text = await fetchUrlSummary(ai, url);
      return { content: [{ type: "text", text }] };
    },
  );

  server.tool(
    "transcribe_youtube",
    "YouTube 動画の URL を受け取り、Gemini が動画を文字起こしします。",
    { url: z.string().url().describe("文字起こしする YouTube 動画の URL") },
    async ({ url }) => {
      const text = await transcribeYoutube(ai, url);
      return { content: [{ type: "text", text }] };
    },
  );

  server.tool(
    "generate_image",
    "Nano Banana Pro (gemini-3-pro-image-preview) でテキストと任意の参照画像から画像を生成／編集し、R2 に保存して URL を返します。",
    {
      prompt: z.string().min(1).describe("生成したい画像の説明"),
      images: z
        .array(
          z.object({
            mimeType: z
              .string()
              .describe(
                "画像のMIMEタイプ (例: image/png, image/jpeg, image/webp)",
              ),
            data: z
              .string()
              .min(1)
              .describe(
                "画像のbase64エンコード済みデータ（data URLプレフィックスなし）",
              ),
          }),
        )
        .optional()
        .describe("参照画像（任意・複数可）。画像編集や合成に使用。"),
    },
    async ({ prompt, images }) => {
      const { base64, mimeType } = await generateImage(ai, prompt, images);
      const ext = mimeType.split("/")[1] ?? "png";
      const key = `${crypto.randomUUID()}.${ext}`;
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      await env.IMAGES.put(key, bytes, {
        httpMetadata: { contentType: mimeType },
      });
      return {
        content: [
          { type: "text", text: `${env.PUBLIC_BASE_URL}/images/${key}` },
        ],
      };
    },
  );
}

function createGeminiMcpHandler(): {
  fetch: (
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ) => Promise<Response>;
} {
  return {
    fetch: (request: Request, env: Env, ctx: ExecutionContext) => {
      const server = new McpServer({
        name: "gemini-mcp",
        version: "0.1.0",
      });
      registerTools(server, env);
      return createMcpHandler(server, { route: "/mcp" })(request, env, ctx);
    },
  };
}

const oauthProvider = new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: createGeminiMcpHandler(),
  // biome-ignore lint/suspicious/noExplicitAny: GitHubHandler (Hono app) is not assignable to OAuthProvider's defaultHandler type
  defaultHandler: GitHubHandler as any,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (
      request.headers.get("x-forwarded-proto") === "https" &&
      url.protocol === "http:"
    ) {
      url.protocol = "https:";
      request = new Request(url.toString(), request);
    }
    return oauthProvider.fetch(request, env, ctx);
  },
};
