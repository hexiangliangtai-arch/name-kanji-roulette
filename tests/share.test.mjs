import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const code = ts.transpileModule(readFileSync("src/lib/share.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function loadShare(globals = {}) {
  const exports = {};
  vm.runInNewContext(code, { exports, URL, URLSearchParams, Error, ...globals });
  return exports;
}

const result = {
  name: "山田 & #太郎\n𠮷",
  entries: [
    { kanji: "山", selectedWord: { word: "登山", reading: "とざん" } },
    { kanji: "田", selectedWord: { word: "田園" } },
    { kanji: "𠮷" },
  ],
};

test("share text includes the submitted name, readings, and missing results in order", () => {
  const share = loadShare();
  assert.equal(share.buildShareText(result),
    "名前漢字ルーレット\n山田 & #太郎\n𠮷さんの結果\n登山（とざん）の『山』\n田園の『田』\n『𠮷』：候補なし");
});

test("site URL drops query and fragment while retaining the deployment path", () => {
  assert.equal(loadShare().getSiteUrl("https://example.com/app/?name=山田#result"), "https://example.com/app/");
});

test("X and LINE URLs round-trip Japanese, newlines, ampersands, and hashes", () => {
  const share = loadShare();
  const text = share.buildShareText(result);
  const siteUrl = "https://example.com/app/";
  const links = share.buildShareLinks(text, siteUrl);
  for (const [key, origin] of [["x", "https://x.com"], ["line", "https://social-plugins.line.me"]]) {
    const url = new URL(links[key]);
    assert.equal(url.origin, origin);
    assert.equal(url.searchParams.get("text"), text);
    if (key === "x") {
      const preview = new URL(url.searchParams.get("url"));
      assert.equal(preview.origin, new URL(siteUrl).origin);
      assert.equal(preview.pathname, "/api/share");
      assert.equal(preview.searchParams.get("text"), text);
      assert.equal(preview.searchParams.get("path"), "/app/");
    } else {
      assert.equal(url.searchParams.get("url"), siteUrl);
    }
  }
});

test("X truncates at Unicode code-point boundaries, preserving LINE text and link", () => {
  const text = "𠮷".repeat(101);
  const siteUrl = "https://example.com/";
  const links = loadShare().buildShareLinks(text, siteUrl);
  assert.equal(new URL(links.x).searchParams.get("text"), "𠮷".repeat(99) + "…");
  const preview = new URL(new URL(links.x).searchParams.get("url"));
  assert.equal(preview.searchParams.get("text"), text);
  assert.equal(new URL(links.line).searchParams.get("text"), text);
});

test("image sharing requires both share and support for the generated file", () => {
  const file = {};
  assert.equal(loadShare({ navigator: {} }).canShareImage(file), false);
  assert.equal(loadShare({ navigator: { share() {}, canShare() { return false; } } }).canShareImage(file), false);
  assert.equal(loadShare({ navigator: { share() {}, canShare() { throw new Error("Blocked"); } } }).canShareImage(file), false);
  assert.equal(loadShare({ navigator: {
    share() {},
    canShare(data) { assert.equal(data.files[0], file); return true; },
  } }).canShareImage(file), true);
});

test("sharing cancellation is distinguished from a failure", () => {
  const share = loadShare();
  const error = new Error("Cancelled");
  error.name = "AbortError";
  assert.equal(share.isShareCancelled(error), true);
  assert.equal(share.isShareCancelled(new Error("Blocked")), false);
});

test("image text wraps long Japanese, astral characters, blank lines, and URLs", () => {
  const { wrapText } = loadShare();
  const measure = (text) => Array.from(text).length;
  assert.deepEqual(Array.from(wrapText("山田𠮷太郎\n\nhttps://example.com", 4, measure)),
    ["山田𠮷太", "郎", "", "http", "s://", "exam", "ple.", "com"]);
});

test("image generation rejects unavailable canvas so the UI can offer a retry", async () => {
  const share = loadShare({ document: { fonts: { ready: Promise.resolve() }, createElement() {
    return { getContext() { return null; } };
  } } });
  await assert.rejects(share.createResultImage(result, "https://example.com/"), /Canvas is unavailable/);
});
