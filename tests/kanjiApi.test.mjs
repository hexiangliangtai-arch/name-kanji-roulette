import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const characters = ["山", ...Array.from({ length: 513 }, (_, i) => String.fromCodePoint(0x4e00 + i))];
const indexHtml = characters.map((kanji, i) => `<a href="${1000000 + i}">${kanji}</a>`).join("");

function createApi(filename, fetchOverride) {
  let now = 0;
  const calls = [];
  const exports = {};
  const code = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    Date: class extends Date { static now() { return now; } },
    console: { error() {} },
    fetch: async (url) => {
      calls.push(url);
      if (fetchOverride) await fetchOverride(url);
      const kanji = characters[Number(new URL(url).pathname.slice(1)) - 1000000];
      return { ok: true, text: async () => kanji ? `<a href="word">${kanji}山（やま）</a>` : indexHtml };
    },
  });
  const handler = exports.default ?? exports.handleKanjiApiRequest;
  return {
    calls,
    advance() { now += 60_000; },
    async request(kanji = "山", method = "GET") {
      const headers = {};
      let body;
      const res = {
        statusCode: 200,
        setHeader(key, value) { headers[key] = value; },
        end(value) { body = JSON.parse(value); },
      };
      await handler({ method, url: `/?kanji=${encodeURIComponent(kanji)}` }, res);
      return { status: res.statusCode, headers, body };
    },
  };
}

for (const filename of ["api/kanji.ts", "src/server/kanjiApi.ts"]) {
  test(`${filename}: rejects invalid input without upstream requests`, async () => {
    const api = createApi(filename);
    assert.equal((await api.request("山", "POST")).status, 405);
    assert.equal((await api.request("山田")).status, 400);
    assert.equal((await api.request("https://example.com")).status, 400);
    assert.equal(api.calls.length, 0);
  });

  test(`${filename}: shares concurrent lookups and caches unchanged results`, async () => {
    const api = createApi(filename);
    const results = await Promise.all(Array.from({ length: 20 }, () => api.request()));
    assert.ok(results.every(({ status }) => status === 200));
    assert.deepEqual(results[0].body, {
      kanji: "山", candidates: [{ word: "山山", reading: "やま" }], source: "external",
    });
    assert.equal(api.calls.length, 2);
    await api.request();
    assert.equal(api.calls.length, 2);
  });

  test(`${filename}: shares the index across different simultaneous characters`, async () => {
    const api = createApi(filename);
    const results = await Promise.all(characters.slice(0, 10).map((kanji) => api.request(kanji)));
    assert.ok(results.every(({ status }) => status === 200));
    assert.equal(api.calls.filter((url) => new URL(url).pathname === "/").length, 1);
    assert.equal(api.calls.length, 11);
  });

  test(`${filename}: limits bursts and accepts requests after the window resets`, async () => {
    const api = createApi(filename);
    for (let i = 0; i < 120; i++) assert.equal((await api.request()).status, 200);
    const limited = await api.request();
    assert.equal(limited.status, 429);
    assert.equal(limited.headers["retry-after"], "60");
    assert.equal(limited.headers["cache-control"], "no-store");
    assert.equal(api.calls.length, 2);
    api.advance();
    assert.equal((await api.request()).status, 200);
  });

  test(`${filename}: bounds concurrent cache misses and releases slots`, async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const api = createApi(filename, () => gate);
    const pending = characters.slice(0, 16).map((kanji) => api.request(kanji));
    const limited = await api.request(characters[16]);
    assert.equal(limited.status, 429);
    assert.equal(limited.headers["retry-after"], "1");
    release();
    assert.ok((await Promise.all(pending)).every(({ status }) => status === 200));
    assert.equal((await api.request(characters[16])).status, 200);
  });

  for (const failIndex of [true, false]) {
    test(`${filename}: retries after ${failIndex ? "index" : "candidate"} fetch failure`, async () => {
      let failed = false;
      const api = createApi(filename, (url) => {
        if (!failed && (new URL(url).pathname === "/") === failIndex) {
          failed = true;
          throw new Error("Upstream unavailable");
        }
      });
      const failures = await Promise.all(Array.from({ length: 3 }, () => api.request()));
      assert.ok(failures.every(({ status }) => status === 502));
      assert.deepEqual(failures[0].body, { error: "External candidate fetch failed" });
      assert.equal((await api.request()).status, 200);
      assert.equal(api.calls.length, 3);
    });
  }

  test(`${filename}: bounds the candidate cache`, async () => {
    const api = createApi(filename);
    for (const kanji of characters) {
      api.advance();
      assert.equal((await api.request(kanji)).status, 200);
    }
    const before = api.calls.length;
    await api.request(characters[0]);
    assert.equal(api.calls.length, before + 1);
  });
}
