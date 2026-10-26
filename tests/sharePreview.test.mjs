import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Exercise the actual server handler without requiring a TypeScript test runner.
const source = ts.transpileModule(readFileSync("api/share.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText.replace(/from "(react|@vercel\/og)"/g, (_, name) => `from "${import.meta.resolve(name)}"`);
const { default: handler } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

const text = "名前漢字ルーレット\n山田太郎さんの結果\n登山（とざん）の『山』\n田園の『田』\n太陽の『太』\n新郎の『郎』";

async function request(params = { text }, method = "GET", headers = { host: "example.com" }) {
  let body;
  const response = {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { body = value; },
  };
  await handler({ method, url: `/api/share?${new URLSearchParams(params)}`, headers }, response);
  return { status: response.statusCode, headers: response.headers, body };
}

test("shared page exposes result-specific X and OG metadata without JavaScript", async () => {
  const result = await request({ text, path: "/app/" });
  assert.equal(result.status, 200);
  assert.match(result.headers["content-type"], /text\/html/);
  assert.match(result.body, /name="twitter:card" content="summary_large_image"/);
  const image = result.body.match(/name="twitter:image" content="([^"]+)"/)[1].replaceAll("&amp;", "&");
  const url = new URL(image);
  assert.equal(url.origin, "https://example.com");
  assert.equal(url.searchParams.get("text"), text);
  assert.equal(url.searchParams.get("image"), "1");
  assert.equal(url.searchParams.get("path"), "/app/");
  assert.ok(result.body.includes('href="https://example.com/app/"'));
  assert.equal(result.headers["x-robots-tag"], "noindex");
});

test("shared text is escaped in visible content and metadata", async () => {
  const result = await request({ text: '<script>alert("x")</script>\n山 & #田' });
  assert.equal(result.status, 200);
  assert.ok(!result.body.includes("<script>"));
  assert.ok(result.body.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"));
  assert.ok(result.headers["content-security-policy"].includes("default-src 'none'"));
});

test("invalid data, off-site return paths, and unsupported methods are rejected", async () => {
  for (const params of [{}, { text: " " }, { text: "山".repeat(4097) },
    { text, path: "//evil.example" }, { text, path: "/\\evil.example" },
    { text, path: "/\n/evil.example" }, { text, path: "https://evil.example" }]) {
    const result = await request(params);
    assert.equal(result.status, 400);
    assert.equal(result.headers["cache-control"], "no-store");
  }
  assert.equal((await request({ text }, "POST")).status, 405);
});

test("HEAD serves crawler headers without a response body", async () => {
  for (const params of [{ text }, { text, image: "1" }]) {
    const result = await request(params, "HEAD");
    assert.equal(result.status, 200);
    assert.equal(result.body, undefined);
    assert.match(result.headers["cache-control"], /public/);
  }
});

test("actual Japanese result image is a cacheable 1200 by 630 PNG", async () => {
  const result = await request({ text, image: "1" });
  assert.equal(result.status, 200);
  assert.equal(result.headers["content-type"], "image/png");
  assert.match(result.headers["cache-control"], /s-maxage=86400/);
  assert.equal(result.body.subarray(1, 4).toString(), "PNG");
  assert.equal(result.body.readUInt32BE(16), 1200);
  assert.equal(result.body.readUInt32BE(20), 630);
  assert.ok(result.body.length < 5_000_000);
});

test("local development preview URLs retain HTTP", async () => {
  const result = await request({ text }, "GET", { host: "127.0.0.1:5176" });
  assert.ok(result.body.includes("http://127.0.0.1:5176/api/share?"));
});

test("image generation bounds concurrency and allows subsequent requests", async () => {
  const results = await Promise.all(Array.from({ length: 3 }, () => request({ text, image: "1" })));
  assert.deepEqual(results.map((result) => result.status), [200, 200, 429]);
  assert.equal(results[2].headers["retry-after"], "1");
  assert.equal((await request({ text, image: "1" })).status, 200);
});
