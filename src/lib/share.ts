import type { WordCandidate } from "../types";

export const SHARE_TITLE = "名前漢字ルーレット";

export type ShareResult = {
  name: string;
  entries: { kanji: string; selectedWord?: WordCandidate }[];
};

export function getSiteUrl(currentUrl: string): string {
  const url = new URL(currentUrl);
  url.search = "";
  url.hash = "";
  return url.href;
}

export function formatResultEntry(entry: ShareResult["entries"][number]): string {
  if (!entry.selectedWord) return `『${entry.kanji}』：候補なし`;
  const { word, reading } = entry.selectedWord;
  return `${word}${reading ? `（${reading}）` : ""}の『${entry.kanji}』`;
}

export function buildShareText(result: ShareResult): string {
  return [
    SHARE_TITLE,
    `${result.name}さんの結果`,
    ...result.entries.map(formatResultEntry),
  ].join("\n");
}

export function buildShareLinks(text: string, siteUrl: string) {
  const characters = Array.from(text);
  const xText = characters.length > 100 ? `${characters.slice(0, 99).join("")}…` : text;
  const x = new URL("https://x.com/intent/tweet");
  x.search = new URLSearchParams({ text: xText, url: siteUrl }).toString();
  const line = new URL("https://social-plugins.line.me/lineit/share");
  line.search = new URLSearchParams({ text, url: siteUrl }).toString();
  return { x: x.href, line: line.href };
}

export function canShareImage(file: File): boolean {
  try {
    return typeof navigator.share === "function" &&
      typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export function isShareCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

// Measure individual code points so Japanese, emoji, and long unbroken URLs wrap too.
export function wrapText(
  text: string,
  maxWidth: number,
  measure: (text: string) => number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r\n?|\n/)) {
    let line = "";
    for (const character of Array.from(paragraph)) {
      if (line && measure(line + character) > maxWidth) {
        lines.push(line);
        line = "";
      }
      line += character;
    }
    lines.push(line);
  }
  return lines;
}

export async function createResultImage(result: ShareResult, siteUrl: string): Promise<File> {
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");

  const width = 1080;
  const padding = 72;
  const contentWidth = width - padding * 2;
  const fontFamily = '"Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP", sans-serif';
  type TextBlock = { lines: string[]; font: string; color: string; lineHeight: number; gap: number };
  const blocks: TextBlock[] = [];
  function addBlock(text: string, size: number, color: string, gap: number, bold = false) {
    const font = `${bold ? "700 " : ""}${size}px ${fontFamily}`;
    context!.font = font;
    blocks.push({
      lines: wrapText(text, contentWidth, (value) => context!.measureText(value).width),
      font, color, lineHeight: Math.ceil(size * 1.65), gap,
    });
  }

  addBlock("名前からひらく熟語の一文字", 25, "#426b55", 16);
  addBlock(SHARE_TITLE, 54, "#231f1a", 34, true);
  addBlock(`${result.name}さんの結果`, 40, "#9f352d", 36, true);
  result.entries.forEach((entry, index) => {
    addBlock(`${index + 1}. ${formatResultEntry(entry)}`, 36, "#231f1a", 22, true);
  });
  addBlock("あなたの名前でもルーレット！", 25, "#426b55", 10);
  addBlock(siteUrl, 23, "#766f64", 0);

  const height = padding * 2 + blocks.reduce((sum, block) => sum + block.lines.length * block.lineHeight + block.gap, 0);
  // Fail gracefully rather than create a blank or truncated image on mobile devices.
  if (height > 12000 || width * height > 16_000_000) {
    throw new Error("Result is too large to export as one image");
  }
  canvas.width = width;
  canvas.height = height;
  context.fillStyle = "#f6f2ea";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#fffaf1";
  context.fillRect(28, 28, width - 56, height - 56);
  context.strokeStyle = "#d8cbb8";
  context.lineWidth = 2;
  context.strokeRect(28, 28, width - 56, height - 56);
  context.fillStyle = "#9f352d";
  context.fillRect(28, 28, width - 56, 8);
  context.textBaseline = "top";

  let y = padding;
  for (const block of blocks) {
    context.font = block.font;
    context.fillStyle = block.color;
    for (const line of block.lines) {
      context.fillText(line, padding, y);
      y += block.lineHeight;
    }
    y += block.gap;
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG export failed")), "image/png");
  });
  return new File([blob], "name-kanji-roulette.png", { type: "image/png" });
}
