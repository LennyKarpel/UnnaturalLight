// Browser tests' harness: starts the show server on a free port with a
// temporary data folder (never server/data), and a headless Chrome driven over
// the DevTools protocol (with the repo's `ws`). Each page is a real app
// window: keys and clicks go through Chrome's own input, like a person's.
//
// Chrome: $CHROME_PATH, else the usual install places. Without one the tests
// are skipped (see `chromePath`).

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const CHROMES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

/** The Chrome to run, or null (then the browser tests skip). */
export const chromePath = (): string | null => [process.env.CHROME_PATH, ...CHROMES].find((p): p is string => !!p && fs.existsSync(p)) ?? null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A port nothing is listening on (for a test server). */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

/** Wait until `check` returns something truthy (polled), or fail with `what`. */
export async function waitFor<T>(check: () => T | Promise<T>, what: string, timeout = 5000): Promise<T> {
  const end = Date.now() + timeout;
  let last: unknown;
  for (;;) {
    try {
      const v = await check();
      if (v) return v;
    } catch (err) {
      last = err;
    }
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}${last ? ` (${last})` : ""}`);
    await sleep(50);
  }
}

export type Page = Awaited<ReturnType<typeof openPage>>;

/** One tab, over its DevTools socket. */
async function openPage(debugPort: number, url: string) {
  const target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json()) as { id: string; webSocketDebuggerUrl: string };
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  let next = 0;
  const pending = new Map<number, (msg: { result?: Record<string, unknown>; error?: { message: string } }) => void>();
  /** Uncaught errors, console.error / console.warn and Content-Security-Policy blocks on the page. */
  const errors: string[] = [];
  ws.on("message", (data) => {
    const msg = JSON.parse(String(data));
    if (msg.id != null) { pending.get(msg.id)?.(msg); pending.delete(msg.id); return; }
    if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    // The browser's own messages: a Content-Security-Policy block counts as an error (the policy must never stop the app).
    if (msg.method === "Log.entryAdded" && /Content Security Policy/i.test(msg.params.entry.text)) errors.push(msg.params.entry.text);
    if (msg.method === "Runtime.consoleAPICalled" && (msg.params.type === "error" || msg.params.type === "warning")) {
      errors.push(msg.params.args.map((a: { value?: unknown; description?: string }) => a.value ?? a.description).join(" "));
    }
  });
  const send = (method: string, params: Record<string, unknown> = {}) => new Promise<Record<string, unknown>>((resolve, reject) => {
    const id = ++next;
    pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result ?? {})));
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send("Runtime.enable");
  await send("Log.enable"); // also reports what was logged before (the page is already loading)
  await send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 1200, deviceScaleFactor: 1, mobile: false });

  /** Run `expr` in the page (awaited) and return its value (JSON). Throws the page's error. */
  async function evaluate<T = unknown>(expr: string): Promise<T> {
    const r = (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })) as {
      result: { value?: T }; exceptionDetails?: { exception?: { description?: string }; text: string };
    };
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value as T;
  }

  const KEYS: Record<string, { code: string; vk: number }> = {
    Delete: { code: "Delete", vk: 46 }, Backspace: { code: "Backspace", vk: 8 }, Escape: { code: "Escape", vk: 27 },
    Enter: { code: "Enter", vk: 13 }, z: { code: "KeyZ", vk: 90 },
    Tab: { code: "Tab", vk: 9 }, "-": { code: "Minus", vk: 189 }, "=": { code: "Equal", vk: 187 },
  };

  /** Keys and clicks only reach the tab in front, as with a person's: bring this one there first. */
  const front = () => send("Page.bringToFront");

  const page = {
    errors,
    evaluate,
    /** Any DevTools protocol command on this tab (e.g. the profiler), for what the helpers here don't cover. */
    cdp: send,
    /** Wait until `expr` is truthy in the page. */
    waitFor: <T = unknown>(expr: string, what = expr, timeout?: number) => waitFor(() => evaluate<T>(expr), what, timeout),
    /** A real key press (keydown + keyup), e.g. key("z", { meta: true }). */
    async key(key: string, { meta = false, shift = false } = {}) {
      const k = KEYS[key];
      if (!k) throw new Error(`No key code for ${key}`);
      await front();
      const modifiers = (meta ? 4 : 0) | (shift ? 8 : 0);
      const base = { key, code: k.code, windowsVirtualKeyCode: k.vk, modifiers };
      await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
      await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    },
    /** A real click in the middle of the first element matching `selector`. */
    async click(selector: string) {
      await front();
      // Scrolled into view where nothing covers it (a sticky scroll bar strip
      // can), once it stops moving (a smooth scroll may be under way).
      const at = await evaluate<{ x: number; y: number; covered?: string } | null>(`(async () => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        const center = () => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
        const settled = async () => {
          let last = center();
          for (let i = 0; i < 60; i++) {
            await new Promise((r) => requestAnimationFrame(() => r()));
            const now = center();
            if (now.x === last.x && now.y === last.y) return now;
            last = now;
          }
          return last;
        };
        let covered = "";
        for (const block of ["center", "start", "end"]) {
          el.scrollIntoView({ block, inline: "nearest" });
          const now = await settled();
          const hit = document.elementFromPoint(now.x, now.y);
          if (!hit || el.contains(hit)) return now;
          covered = (hit.className || hit.tagName) + " in " + (hit.parentElement?.className ?? "");
        }
        return { ...center(), covered };
      })()`);
      if (!at) throw new Error(`Nothing matches ${selector}`);
      if (at.covered) throw new Error(`${selector} is under ${at.covered}`);
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
        await send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: type === "mouseMoved" ? "none" : "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
      }
    },
    /** Type text into whatever has focus. */
    async type(text: string) {
      await front();
      await send("Input.insertText", { text });
    },
    /** Save a screenshot (for looking into a failure). */
    async screenshot(file: string) {
      const { data } = (await send("Page.captureScreenshot", { format: "png" })) as { data: string };
      fs.writeFileSync(file, Buffer.from(data, "base64"));
    },
    async close() {
      ws.close();
      await fetch(`http://127.0.0.1:${debugPort}/json/close/${target.id}`).catch(() => {});
    },
  };
  // Ready: the console and the stage are up, and connected to the server (another page: loaded).
  if (new URL(url).pathname === "/index.html") await page.waitFor("document.readyState === 'complete' && !!window.consoleChat && !!window.stageChat && document.querySelector('#chatPanel .chat-name')", "the app to start", 15000);
  else await page.waitFor("document.readyState === 'complete'", "the page to load", 15000);
  return page;
}

/**
 * The server and Chrome; `page()` opens another app window. Call `close()`
 * when done. `data`: a folder whose files the server starts with (copied).
 */
/**
 * `chatModels`: give the chat the real provider (Anthropic), so it can list
 * its models; without an API key, and a test must never send a message then.
 */
export async function startApp({ data, chatModels = false }: { data?: string; chatModels?: boolean } = {}) {
  const chrome = chromePath();
  if (!chrome) throw new Error("No Chrome found (set CHROME_PATH)");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "unnaturallight-browser-"));
  const dataDir = path.join(tmp, "data");
  const profile = path.join(tmp, "chrome");
  fs.mkdirSync(dataDir);
  if (data) fs.cpSync(data, dataDir, { recursive: true });
  const port = await freePort();
  const procs: ChildProcess[] = [];

  // The chat gets a provider that doesn't exist, so it never calls a real model.
  const env: NodeJS.ProcessEnv = { ...process.env, UNNATURALLIGHT_DATA_DIR: dataDir, UNNATURALLIGHT_CHAT_PROVIDER: chatModels ? "anthropic" : "none-in-tests" };
  delete env.ANTHROPIC_API_KEY;
  const server = spawn(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "server/server.ts", String(port), "--no-open"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  procs.push(server);
  let serverLog = "";
  server.stdout?.on("data", (d) => { serverLog += d; });
  server.stderr?.on("data", (d) => { serverLog += d; });
  await waitFor(() => serverLog.includes("this Mac"), `the show server (log: ${serverLog})`, 15000);

  // Background tabs keep full speed (Chrome otherwise slows their timers, and a stage edit is sent 0.2 s after it's made).
  const flags = ["--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"];
  const browser = spawn(chrome, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", ...flags, "about:blank"], { stdio: "ignore" });
  procs.push(browser);
  const portFile = path.join(profile, "DevToolsActivePort");
  const debugPort = await waitFor(() => (fs.existsSync(portFile) ? Number(fs.readFileSync(portFile, "utf8").split("\n")[0]) : 0), "Chrome to start", 15000);

  const url = `http://localhost:${port}/index.html`;
  const pages: Page[] = [];
  return {
    url,
    dataDir,
    /** The server's output so far (to show when something fails). */
    serverLog: () => serverLog,
    /** A new tab with the app, or another of its pages (e.g. "page/help.html#…"). */
    async page(rel = "index.html") {
      const p = await openPage(debugPort, new URL(rel, url).href);
      pages.push(p);
      return p;
    },
    async close() {
      for (const p of pages) await p.close().catch(() => {});
      for (const proc of procs) proc.kill();
      await sleep(200);
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
}
