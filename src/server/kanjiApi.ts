import type { IncomingMessage, ServerResponse } from "node:http";
import type { WordCandidate } from "../types";

const BASE_URL = "https://kanji.nonai.jp/";
const REQUEST_TIMEOUT_MS = 4500;

type KanjiIndex = Map<string, string>;

let indexCache: KanjiIndex | null = null;
const candidateCache = new Map<string, WordCandidate[]>();

export function createKanjiApiMiddleware() {
  return handleKanjiApiRequest;
}

export async function handleKanjiApiRequest(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const url = new URL(req.url ?? "", "http://localhost");
    const kanji = url.searchParams.get("kanji")?.trim() ?? "";

    if (!/^\p{Script=Han}$/u.test(kanji)) {
      sendJson(res, 400, { error: "kanji must be one Han character" });
      return;
    }

    const candidates = await getExternalCandidates(kanji);
    sendJson(res, 200, { kanji, candidates, source: "external" });
  } catch (error) {
    console.error("Kanji proxy API failed", error);
    sendJson(res, 502, { error: "External candidate fetch failed" });
  }
}

async function getExternalCandidates(kanji: string): Promise<WordCandidate[]> {
  const cached = candidateCache.get(kanji);
  if (cached) {
    return cached;
  }

  const index = await getKanjiIndex();
  const pagePath = index.get(kanji);
  if (!pagePath) {
    candidateCache.set(kanji, []);
    return [];
  }

  const html = await fetchText(new URL(pagePath, BASE_URL).toString());
  const candidates = extractWordsFromKanjiPage(html, kanji);
  candidateCache.set(kanji, candidates);
  return candidates;
}

async function getKanjiIndex(): Promise<KanjiIndex> {
  if (indexCache) {
    return indexCache;
  }

  const html = await fetchText(BASE_URL);
  const index = new Map<string, string>();
  const linkPattern = /<a\s+[^>]*href=(?:"([^"]+)"|'([^']+)'|([^>\s]+))[^>]*>([^<]+)<\/a>/g;
  let match: RegExpExecArray | null;

  while ((match = linkPattern.exec(html)) !== null) {
    const href = decodeHtml(match[1] ?? match[2] ?? match[3] ?? "");
    const label = decodeHtml(match[4]).trim();
    if (/^\p{Script=Han}$/u.test(label) && /^\.?\/?\d{7}$/.test(href)) {
      index.set(label, href.replace(/^\.\//, ""));
    }
  }

  indexCache = index;
  return index;
}

function extractWordsFromKanjiPage(html: string, kanji: string): WordCandidate[] {
  const contentArea = html.split("同じ部首の漢字")[0] ?? html;
  const words = new Map<string, WordCandidate>();
  const linkPattern = /<a\s+[^>]*>([^<]+)<\/a>/g;
  let match: RegExpExecArray | null;

  while ((match = linkPattern.exec(contentArea)) !== null) {
    const raw = decodeHtml(match[1]);
    const reading = raw.match(/[（(]([ぁ-んァ-ヶー]+)[）)]/)?.[1];
    const word = raw
      .replace(/\(.+?\)/g, "")
      .replace(/（.+?）/g, "")
      .replace(/\[.+?\]/g, "")
      .trim();

    if (word.includes(kanji) && /^[\p{Script=Han}ぁ-んァ-ヶーの]+$/u.test(word) && word.length >= 2) {
      words.set(word, reading ? { word, reading } : { word });
    }
  }

  return Array.from(words.values()).slice(0, 80);
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "name-roulette-app/1.0 (+local development)",
        accept: "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) {
      throw new Error(`Fetch failed with ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}
