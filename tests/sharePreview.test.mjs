import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createHash } from "node:crypto";
import vm from "node:vm";
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

test("shared page exposes a site thumbnail without including personal results", async () => {
  const result = await request({ text, path: "/app/" });
  assert.equal(result.status, 200);
  assert.match(result.headers["content-type"], /text\/html/);
  assert.match(result.body, /name="twitter:card" content="summary_large_image"/);
  const image = result.body.match(/name="twitter:image" content="([^"]+)"/)[1].replaceAll("&amp;", "&");
  const url = new URL(image);
  assert.equal(url.origin, "https://example.com");
  assert.equal(url.searchParams.has("text"), false);
  assert.equal(url.pathname, "/share-screen.png");
  assert.ok(!result.body.includes("山田太郎"));
  assert.ok(result.body.includes('href="https://example.com/app/#name-input"'));
  assert.equal(result.headers["x-robots-tag"], "noindex");
});

test("legacy result text is ignored and the permitted script navigates to the input", async () => {
  const result = await request({ text: '<script>alert("x")</script>\n山 & #田' });
  assert.equal(result.status, 200);
  assert.ok(!result.body.includes('alert("x")'));
  assert.ok(!result.body.includes("山 & #田"));
  const script = result.body.match(/<script>(.*?)<\/script>/s)[1];
  const hash = createHash("sha256").update(script).digest("base64");
  assert.ok(result.headers["content-security-policy"].includes(`'sha256-${hash}'`));
  let target;
  vm.runInNewContext(script, { location: { replace(url) { target = url; } } });
  assert.equal(target, "https://example.com/#name-input");
  assert.ok(result.headers["content-security-policy"].includes("default-src 'none'"));
});

test("off-site return paths and unsupported methods are rejected", async () => {
  for (const params of [{ text, path: "//evil.example" }, { text, path: "/\\evil.example" },
    { text, path: "/\n/evil.example" }, { text, path: "https://evil.example" }]) {
    const result = await request(params);
    assert.equal(result.status, 400);
    assert.equal(result.headers["cache-control"], "no-store");
  }
  assert.equal((await request({ text }, "POST")).status, 405);
});

test("HEAD serves crawler headers without a response body", async () => {
  for (const params of [{ text }]) {
    const result = await request(params, "HEAD");
    assert.equal(result.status, 200);
    assert.equal(result.body, undefined);
    assert.match(result.headers["cache-control"], /public/);
  }
});

test("the actual screen capture is a public 1200 by 630 PNG", () => {
  const image = readFileSync("public/share-screen.png");
  assert.equal(image.subarray(1, 4).toString(), "PNG");
  assert.equal(image.readUInt32BE(16), 1200);
  assert.equal(image.readUInt32BE(20), 630);
  assert.ok(image.length < 5_000_000);
});

test("local development preview URLs retain HTTP", async () => {
  const result = await request({ text }, "GET", { host: "127.0.0.1:5176" });
  assert.ok(result.body.includes("http://127.0.0.1:5176/api/share?"));
});

test("legacy image URLs redirect to the screen capture without generating images", async () => {
  const results = await Promise.all(Array.from({ length: 3 }, () => request({ text, image: "1" })));
  assert.ok(results.every((result) => result.status === 307));
  assert.ok(results.every((result) => result.headers.location === "https://example.com/share-screen.png"));
});
