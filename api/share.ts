import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createElement } from "react";
import { ImageResponse } from "@vercel/og";

const TITLE = "名前漢字ルーレット";
let fontPromise: Promise<ArrayBuffer> | undefined;
let activeImages = 0;

function getFont(): Promise<ArrayBuffer> {
  fontPromise ??= readFile(join(process.cwd(), "assets/share/NotoSansJP.ttf"))
    .then((buffer) => new Uint8Array(buffer).buffer)
    .catch((error) => { fontPromise = undefined; throw error; });
  return fontPromise;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

async function renderImage(text: string, siteUrl: string): Promise<Buffer> {
  const body = text.startsWith(`${TITLE}\n`) ? text.slice(TITLE.length + 1) : text;
  // Fit ordinary names and longer results inside X's landscape preview.
  let fontSize = 40;
  const rows = body.split(/\r\n?|\n/);
  while (fontSize > 16) {
    const columns = Math.floor(1088 / fontSize);
    const lines = rows.reduce((sum, row) => sum + Math.max(1, Math.ceil(Array.from(row).length / columns)), 0);
    if (lines * fontSize * 1.45 <= 380) break;
    fontSize -= 2;
  }
  const image = new ImageResponse(createElement("div", {
    style: {
      display: "flex", flexDirection: "column", width: "100%", height: "100%",
      padding: "44px 56px", background: "#fffaf1", color: "#231f1a",
      borderTop: "10px solid #9f352d", fontFamily: "Noto Sans JP",
    },
  },
  createElement("div", { style: { fontSize: 46, color: "#9f352d", marginBottom: 24 } }, TITLE),
  createElement("div", {
    style: { display: "flex", flexGrow: 1, fontSize, lineHeight: 1.45, whiteSpace: "pre-wrap", overflowWrap: "anywhere", overflow: "hidden" },
  }, body),
  createElement("div", { style: { fontSize: 22, color: "#426b55", marginTop: 18 } }, siteUrl)), {
    width: 1200, height: 630,
    fonts: [{ name: "Noto Sans JP", data: await getFont(), weight: 400, style: "normal" }],
  });
  return Buffer.from(await image.arrayBuffer());
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const fail = (status: number, message: string) => {
    res.statusCode = status;
    res.setHeader("cache-control", "no-store");
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end(req.method === "HEAD" ? undefined : message);
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("allow", "GET, HEAD");
    fail(405, "Method not allowed");
    return;
  }

  try {
    const host = req.headers.host ?? "localhost";
    const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
    const protocol = req.headers["x-forwarded-proto"] === "http" || local ? "http" : "https";
    const origin = new URL(`${protocol}://${host}`).origin;
    const url = new URL(req.url ?? "/api/share", origin);
    const text = url.searchParams.get("text") ?? "";
    const path = url.searchParams.get("path") ?? "/";
    if (!text.trim() || text.length > 4096 || !path.startsWith("/") ||
        path.startsWith("//") || path.includes("\\") || new URL(path, origin).origin !== origin) {
      fail(400, "Invalid shared result");
      return;
    }
    const site = new URL(path, origin);
    site.search = "";
    site.hash = "";
    const pageUrl = new URL("/api/share", origin);
    pageUrl.search = new URLSearchParams({ text, path: site.pathname }).toString();
    const imageUrl = new URL(pageUrl);
    imageUrl.searchParams.set("image", "1");

    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("x-robots-tag", "noindex");
    if (url.searchParams.get("image") === "1") {
      if (activeImages >= 2) {
        res.setHeader("retry-after", "1");
        fail(429, "Too many image requests");
        return;
      }
      res.setHeader("content-type", "image/png");
      if (req.method === "HEAD") {
        res.setHeader("cache-control", "public, max-age=86400, s-maxage=86400");
        res.end();
        return;
      }
      activeImages += 1;
      try {
        const image = await renderImage(text, site.href);
        res.setHeader("cache-control", "public, max-age=86400, s-maxage=86400");
        res.end(image);
      } finally {
        activeImages -= 1;
      }
      return;
    }

    const escapedText = escapeHtml(text);
    const escapedImage = escapeHtml(imageUrl.href);
    const description = escapeHtml(Array.from(text).slice(0, 180).join(""));
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.setHeader("cache-control", "public, max-age=86400, s-maxage=86400");
    res.setHeader("content-security-policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
    const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${TITLE}｜共有結果</title>
<meta name="robots" content="noindex">
<meta property="og:type" content="website">
<meta property="og:title" content="${TITLE}｜共有結果">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${escapeHtml(pageUrl.href)}">
<meta property="og:image" content="${escapedImage}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${TITLE}｜共有結果">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${escapedImage}">
<meta name="twitter:image:alt" content="${description}">
<style>body{margin:32px auto;padding:0 20px;max-width:800px;background:#f6f2ea;color:#231f1a;font-family:sans-serif;line-height:1.8}img{max-width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}a{color:#9f352d}</style>
</head><body><h1>${TITLE}</h1><img src="${escapedImage}" alt="共有した結果画像" width="1200" height="630">
<pre>${escapedText}</pre><p><a href="${escapeHtml(site.href)}">自分の名前でもルーレットをする</a></p></body></html>`;
    res.end(req.method === "HEAD" ? undefined : html);
  } catch (error) {
    console.error("Shared result preview failed", error);
    fail(500, "Could not generate shared result preview");
  }
}
