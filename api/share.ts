import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
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

async function renderImage(): Promise<Buffer> {
  const image = new ImageResponse(createElement("div", {
    style: {
      display: "flex", flexDirection: "column", justifyContent: "center",
      width: "100%", height: "100%", padding: "56px 64px",
      background: "#fffaf1", color: "#231f1a", borderTop: "12px solid #9f352d",
      fontFamily: "Noto Sans JP",
    },
  },
  createElement("div", { style: { fontSize: 30, color: "#426b55", marginBottom: 28 } }, "名前からひらく熟語の一文字"),
  createElement("div", { style: { fontSize: 76, color: "#9f352d", marginBottom: 24 } }, TITLE),
  createElement("div", { style: { fontSize: 38, marginBottom: 44 } }, "あなたの名前で、熟語をまわそう。"),
  createElement("div", {
    style: { display: "flex", alignSelf: "flex-start", background: "#9f352d", color: "#fffaf1", fontSize: 32, padding: "18px 32px", borderRadius: 12 },
  }, "名前を入力してスタート →")), {
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
    const path = url.searchParams.get("path") ?? "/";
    if (!path.startsWith("/") ||
        path.startsWith("//") || path.includes("\\") || new URL(path, origin).origin !== origin) {
      fail(400, "Invalid site path");
      return;
    }
    const site = new URL(path, origin);
    site.search = "";
    site.hash = "name-input";
    const pageUrl = new URL("/api/share", origin);
    pageUrl.search = new URLSearchParams({ path: site.pathname }).toString();
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
        const image = await renderImage();
        res.setHeader("cache-control", "public, max-age=86400, s-maxage=86400");
        res.end(image);
      } finally {
        activeImages -= 1;
      }
      return;
    }

    const escapedImage = escapeHtml(imageUrl.href);
    const description = "あなたの名前で、熟語をまわそう。名前を入力してスタート！";
    const redirectScript = `location.replace(${JSON.stringify(site.href).replace(/</g, "\\u003c")});`;
    const scriptHash = createHash("sha256").update(redirectScript).digest("base64");
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.setHeader("cache-control", "public, max-age=86400, s-maxage=86400");
    res.setHeader("content-security-policy", `default-src 'none'; script-src 'sha256-${scriptHash}'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'`);
    const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${TITLE}</title>
<meta name="robots" content="noindex">
<meta property="og:type" content="website">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${escapeHtml(pageUrl.href)}">
<meta property="og:image" content="${escapedImage}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${TITLE}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${escapedImage}">
<meta name="twitter:image:alt" content="${description}">
<script>${redirectScript}</script>
<style>body{margin:32px auto;padding:0 20px;max-width:800px;background:#f6f2ea;color:#231f1a;font-family:sans-serif;line-height:1.8}img{max-width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}a{color:#9f352d}</style>
</head><body><h1>${TITLE}</h1><a href="${escapeHtml(site.href)}"><img src="${escapedImage}" alt="名前を入力してスタート" width="1200" height="630"></a>
<p><a href="${escapeHtml(site.href)}">名前を入力してスタート</a></p></body></html>`;
    res.end(req.method === "HEAD" ? undefined : html);
  } catch (error) {
    console.error("Shared result preview failed", error);
    fail(500, "Could not generate shared result preview");
  }
}
