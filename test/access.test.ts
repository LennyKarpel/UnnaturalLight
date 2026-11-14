import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { freePort } from "./browser/harness.ts";
import { accessProblem, BASE_HEADERS, CONNECT_ORIGINS, contentSecurityPolicy, isToken, LOOPBACK_NAMES, publicFile } from "../server/access.ts";

// --- the check -----------------------------------------------------------------

const NAMES = new Set([...LOOPBACK_NAMES, "192.168.1.20", "stage-mac.local"]);
const check = (host: string | undefined, origin?: string) => accessProblem({ host, origin }, NAMES, 8080);

test("this machine's own names are let in, with or without a matching Origin", () => {
  for (const host of ["localhost:8080", "127.0.0.1:8080", "[::1]:8080", "LocalHost:8080", "192.168.1.20:8080", "stage-mac.local:8080"]) {
    assert.equal(check(host), null, host);
    assert.equal(check(host, `http://${host}`), null, host);
  }
});

test("other names are refused (DNS rebinding)", () => {
  assert.match(check("rebind.evil.example:8080") ?? "", /unknown host/);
  assert.match(check("localhost.evil.example:8080") ?? "", /unknown host/);
  assert.match(check("192.168.1.99:8080") ?? "", /unknown host/);
  assert.match(check(undefined) ?? "", /no Host/);
  assert.match(check("") ?? "", /no Host/);
});

test("the wrong port, or junk, is refused", () => {
  assert.match(check("localhost:9090") ?? "", /unknown host/);
  assert.match(check("localhost") ?? "", /unknown host/); // port 80
  assert.match(check("localhost:8080/x") ?? "", /unknown host/);
  assert.match(check("user@localhost:8080") ?? "", /unknown host/);
  assert.equal(accessProblem({ host: "localhost" }, NAMES, 80), null);
});

test("pages from other sites are refused", () => {
  assert.match(check("localhost:8080", "https://evil.example") ?? "", /foreign origin/);
  assert.match(check("localhost:8080", "http://localhost:9090") ?? "", /foreign origin/);
  assert.match(check("localhost:8080", "https://localhost:8080") ?? "", /foreign origin/);
  // Same machine, but another name: a different site as far as the browser goes.
  assert.match(check("localhost:8080", "http://127.0.0.1:8080") ?? "", /foreign origin/);
  // Sandboxed frames and file:// pages send "null".
  assert.match(check("localhost:8080", "null") ?? "", /bad origin/);
});

test("the token must match exactly", () => {
  assert.equal(isToken("abc123", "abc123"), true);
  for (const given of [null, "", "abc12", "abc1234", "ABC123", "abc12３"]) assert.equal(isToken(given, "abc123"), false, String(given));
});

// --- which files are served ------------------------------------------------------

test("only the app's files and the vendor folders are served, wherever a path resolves to", () => {
  const root = "/app";
  assert.equal(publicFile(root, "index.html"), "/app/index.html");
  assert.equal(publicFile(root, "shared/html.ts"), "/app/shared/html.ts");
  assert.equal(publicFile(root, "page/../stage/stage.ts"), "/app/stage/stage.ts");
  assert.equal(publicFile(root, "vendor/three/build/three.module.js"), "/app/node_modules/three/build/three.module.js");
  assert.equal(publicFile(root, "vendor/three/examples/jsm/controls/OrbitControls.js"), "/app/node_modules/three/examples/jsm/controls/OrbitControls.js");
  for (const rel of [
    "page/../server/data/session.show.json", // what an encoded ..%2f decodes to
    "page/../package.json",
    "page/../node_modules/ws/package.json",
    "shared/../../etc/passwd",
    "server/server.ts",
    "node_modules/three/build/three.module.js",
    "vendor/three/package.json",
    "vendor/three/build/../package.json",
    "vendor/three/build/../../ws/package.json",
    "vendor/three/examples/jsm/../../../ws/index.js",
    "page\\..\\package.json",
    "page/x\0.ts",
    "/etc/passwd",
    "index.html/../package.json",
  ]) assert.equal(publicFile(root, rel), null, rel);
});

// --- the page's policy ----------------------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policy = (csp: string) => new Map(csp.split("; ").map((d) => { const [name, ...values] = d.split(" "); return [name, values] as const; }));

test("the policy runs the server's scripts, the import map (by hash) and three.js at its version, nothing else", () => {
  const html = `<script src="../page/keep-token.ts"></script><script type="importmap">{"imports":{"three":"https://cdn.example/three@1/three.js","bad":"javascript:alert(1)"}}</script><script>alert(1)</script>`;
  const p = policy(contentSecurityPolicy(html, "localhost:8080"));
  const scripts = p.get("script-src") ?? [];
  assert.equal(scripts[0], "'self'");
  assert.equal(scripts.filter((s) => s.startsWith("'sha256-")).length, 2); // the import map and the inline script, each by its own hash
  assert.ok(scripts.includes("https://cdn.example/three@1/three.js"));
  assert.ok(!scripts.some((s) => /unsafe|javascript|\*/.test(s)), scripts.join(" "));
  assert.deepEqual(p.get("frame-ancestors"), ["'none'"]);
  assert.deepEqual(p.get("object-src"), ["'none'"]);
  assert.deepEqual(p.get("base-uri"), ["'none'"]);
  assert.ok(p.get("connect-src")?.includes("ws://localhost:8080"));
});

test("index.html has no inline script but its import map (the policy runs no other)", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(([, attrs]) => !/\bsrc\s*=/i.test(attrs));
  assert.deepEqual(inline.map(([, attrs]) => attrs.trim()), ['type="importmap"']);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, "inline event handlers never run under the policy");
});

test("the policy lets the page reach every address the fixture library uses", () => {
  const source = fs.readFileSync(path.join(ROOT, "stage/fixture-library.ts"), "utf8");
  const used = new Set([...source.matchAll(/"(https:\/\/[^"/]+)/g)].map((m) => m[1]));
  assert.ok(used.size > 0);
  for (const origin of used) assert.ok(CONNECT_ORIGINS.includes(origin), `${origin} isn't in CONNECT_ORIGINS (server/access.ts)`);
});

// --- the server ----------------------------------------------------------------

let server: ChildProcess;
let tmp: string;
let port: number;


before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "unnaturallight-access-"));
  port = await freePort();
  // Never the real show (a temporary data folder) or a real model (no key, no provider).
  const env: NodeJS.ProcessEnv = { ...process.env, UNNATURALLIGHT_DATA_DIR: tmp, UNNATURALLIGHT_CHAT_PROVIDER: "none-in-tests" };
  delete env.ANTHROPIC_API_KEY;
  server = spawn(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "server/server.ts", String(port), "--no-open", "--fake-dmx"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server didn't start: ${log}`)), 15000);
    const onData = (d: Buffer) => {
      log += d;
      if (log.includes("this Mac")) { clearTimeout(timer); resolve(); }
    };
    server.stdout?.on("data", onData);
    server.stderr?.on("data", onData);
  });
});

after(() => {
  server?.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** An HTTP request to the server (always to 127.0.0.1, whatever Host says), with its status. */
function request(opts: { method?: string; path?: string; headers?: Record<string, string>; body?: string }): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method: opts.method ?? "GET", path: opts.path ?? "/index.html", headers: opts.headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end(opts.body);
  });
}

/** Open the WebSocket with these headers: "open", or the refusal's status. */
function openSocket(headers: { origin?: string; host?: string }): Promise<string> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: headers.origin, headers: headers.host ? { Host: headers.host } : {} });
    ws.on("open", () => { ws.close(); resolve("open"); });
    ws.on("unexpected-response", (_req, res) => resolve(String(res.statusCode)));
    ws.on("error", () => resolve("error"));
  });
}

test("the server's pages load for this machine, and not under another name", async () => {
  const self = `localhost:${port}`;
  assert.equal(await request({ headers: { Host: self } }), 200);
  assert.equal(await request({ headers: { Host: self, Origin: `http://${self}` } }), 200);
  assert.equal(await request({ headers: { Host: `rebind.evil.example:${port}` } }), 403);
  assert.equal(await request({ path: "/chat/chats", headers: { Host: `rebind.evil.example:${port}` } }), 403);
});

test("a malformed address gets a 400 and the server keeps running", async () => {
  const self = `localhost:${port}`;
  // Any page could link to one (a GET from an <img> has no Origin).
  assert.equal(await request({ path: "/%E0%A4%A", headers: { Host: self } }), 400);
  assert.equal(await request({ path: "/%", headers: { Host: self } }), 400);
  assert.equal(await request({ path: "/chat/chats/%E0%A4%A", headers: { Host: self } }), 400);
  assert.equal(await request({ headers: { Host: self } }), 200);
});

test("an encoded ../ can't reach the show, the server or node_modules; three.js is served from vendor/", async () => {
  const self = `localhost:${port}`;
  for (const p of ["/page/..%2fpackage.json", "/page/..%2fserver%2fserver.ts", "/page/..%2fnode_modules%2fws%2fpackage.json", "/vendor/three/build/..%2f..%2fws%2fpackage.json", "/node_modules/three/package.json", "/vendor/three/package.json"]) {
    assert.equal(await request({ path: p, headers: { Host: self } }), 404, p);
  }
  assert.equal(await request({ path: "/vendor/three/build/three.module.js", headers: { Host: self } }), 200);
  assert.equal(await request({ path: "/vendor/three/examples/jsm/controls/OrbitControls.js", headers: { Host: self } }), 200);
});

test("every file is sent with the frame and type headers, and the page with its policy", async () => {
  const self = `localhost:${port}`;
  const get = (p: string) => new Promise<http.IncomingHttpHeaders>((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: p, headers: { Host: self } }, (res) => { res.resume(); resolve(res.headers); }).on("error", reject);
  });
  for (const p of ["/index.html", "/", "/shared/html.ts", "/shared/theme.css"]) {
    const h = await get(p);
    for (const [name, value] of Object.entries(BASE_HEADERS)) assert.equal(h[name.toLowerCase()], value, `${name} on ${p}`);
  }
  const csp = policy(String((await get("/index.html"))["content-security-policy"]));
  assert.deepEqual(csp.get("frame-ancestors"), ["'none'"]);
  // three.js comes from the server (vendor/): no script from anywhere else.
  assert.ok(csp.get("script-src")?.every((s) => s === "'self'" || s.startsWith("'sha256-")), csp.get("script-src")?.join(" "));
  assert.ok(csp.get("connect-src")?.includes(`ws://${self}`));
});

test("the WebSocket opens for the app and not for another site", async () => {
  const self = `localhost:${port}`;
  assert.equal(await openSocket({ origin: `http://${self}`, host: self }), "open");
  assert.equal(await openSocket({ host: self }), "open"); // not a web page (no Origin)
  assert.equal(await openSocket({ origin: "https://evil.example", host: self }), "403");
  assert.equal(await openSocket({ origin: "null", host: self }), "403");
  assert.equal(await openSocket({ host: `rebind.evil.example:${port}` }), "403");
});

test("an oversized WebSocket message closes only that connection", async () => {
  const self = `localhost:${port}`;
  const closed = await new Promise<number>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Host: self } });
    ws.on("open", () => ws.send(Buffer.alloc(17 * 1024 * 1024, 32)));
    ws.on("close", (code) => resolve(code));
    ws.on("error", () => {});
  });
  assert.equal(closed, 1009); // "message too big"
  assert.equal(await openSocket({ host: self }), "open"); // the server is still there
});

test("another site can't POST to the chat; the app's own JSON gets through to it", async () => {
  const self = `localhost:${port}`;
  const body = JSON.stringify({ messages: [{ role: "user", text: "hi" }], tools: [] });
  // A form-style POST from another site (no preflight in a browser).
  assert.equal(await request({ method: "POST", path: "/chat", headers: { Host: self, Origin: "https://evil.example", "Content-Type": "text/plain" }, body }), 403);
  assert.equal(await request({ method: "POST", path: "/chat/summary", headers: { Host: self, Origin: "https://evil.example", "Content-Type": "text/plain" }, body }), 403);
  // Not JSON, even from the app itself: refused before the model is asked.
  assert.equal(await request({ method: "POST", path: "/chat", headers: { Host: self, Origin: `http://${self}`, "Content-Type": "text/plain" }, body }), 415);
  // The app's own request reaches the chat (which streams back 200; the test provider then reports its error inside the stream).
  assert.equal(await request({ method: "POST", path: "/chat", headers: { Host: self, Origin: `http://${self}`, "Content-Type": "application/json" }, body }), 200);
});
