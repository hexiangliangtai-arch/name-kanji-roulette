import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";

const TITLE = "名前漢字ルーレット";
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
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
    pageUrl.search = new URLSearchParams({ path: site.pathname, v: "screen-1" }).toString();
    const imageUrl = new URL("/share-screen.png", origin);

    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("x-robots-tag", "noindex");
    if (url.searchParams.get("image") === "1") {
      res.statusCode = 307;
      res.setHeader("location", imageUrl.href);
      res.setHeader("cache-control", "public, max-age=86400, s-maxage=86400");
      res.end();
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
