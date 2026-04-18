import {
  createPartFromBase64,
  type GoogleGenAI,
  type Part,
} from "@google/genai";

export async function fetchUrlSummary(
  ai: GoogleGenAI,
  url: string,
): Promise<string> {
  const res = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: `次のURLの内容を確認し、サイトの情報をマークダウン形式で詳細に出力してください: ${url}

## 出力ルール

- サイトの構造（見出し、セクション、リスト、表など）をそのままマークダウンに変換して再現する
- 要約ではなく、ページに記載されている情報をなるべく詳しく漏れなく記載する
- 日本語で出力する（原文が日本語でない場合は日本語訳を出力する）
- ヘッダー・フッター・ナビゲーション・広告・関連記事リンクなど本文に関係ない要素は含めない
- まとめた内容のみを出力する。前置きなど余計なものは出力しない`,
    config: { tools: [{ urlContext: {} }] },
  });
  return res.text ?? "";
}

export async function transcribeYoutube(
  ai: GoogleGenAI,
  url: string,
): Promise<string> {
  const res = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: [
      {
        role: "user",
        parts: [
          { fileData: { fileUri: url } },
          {
            text: `提供されたYoutube動画について内容を確認した上で内容を詳細に教えてください。

## 内容のまとめ方

セクションの内容を示す文を見出し3（###）形式で1行書いたあと、セクションの内容を箇条書きで整理する。まとめた内容のみを出力する。前置きなど余計なものは出力しない

~~~
### (セクション1の内容を示す言葉)

- セクション1で語られている内容1
- セクション1で語られている内容2
:

### (セクション2の内容を示す言葉)

- セクション2で語られている内容1
:
~~~

## 内容抽出時のルール

- Youtubeの内容を漏れなくすべて記載する
- 内容に関しては「NVIDIAのビジネス展望について」など結論が分からない形ではなく、「NVIDIAの天下は今後10年続く」のように主張内容が分かるようにかく
- オープニングやエンディング、告知、番組自体に関する説明といった本編に関係ない内容は含めない
- Youtubeのタイトルやディスクリプションだけでなく、実際の動画の内容に基づいてかく`,
          },
        ],
      },
    ],
  });
  return res.text ?? "";
}

export async function generateImage(
  ai: GoogleGenAI,
  prompt: string,
  images: Array<{ mimeType: string; data: string }> = [],
): Promise<{ base64: string; mimeType: string }> {
  const parts: Part[] = [
    { text: prompt },
    ...images.map((img) => createPartFromBase64(img.data, img.mimeType)),
  ];

  const res = await ai.models.generateContent({
    model: "gemini-3-pro-image-preview",
    contents: parts,
  });

  for (const part of res.candidates?.[0]?.content?.parts ?? []) {
    if (part.inlineData?.data) {
      return {
        base64: part.inlineData.data,
        mimeType: part.inlineData.mimeType ?? "image/png",
      };
    }
  }

  throw new Error("No image returned from Gemini");
}
