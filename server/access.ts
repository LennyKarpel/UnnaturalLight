// Which web pages may talk to the show server (./server.ts).
//
// The server lets this machine in without the token, but every web page open
// in this machine's browser connects from this machine too. Two headers tell
// the app's own pages from the rest:
//
//   - Host: the name the page used to reach the server. Only this machine's
//     own names (localhost, 127.0.0.1, [::1]; with --lan, its LAN addresses
//     and host name) are accepted, so a site that points its own name at
//     127.0.0.1 (DNS rebinding) can't read anything back.
//   - Origin: the site of the page making the request, set by the browser
//     (a page can't fake it). When present it must be the server itself, so
//     another site can't open the WebSocket (which browsers allow across
//     sites) or POST to it. A request without one isn't from a web page
//     (curl, the tests): the Host check and the token still apply.
//
// And what a page may do once it's loaded (BASE_HEADERS,
// contentSecurityPolicy): it can't be put in another site's frame (so no
// site can trick clicks on it), and its Content-Security-Policy runs only
// the app's own scripts, so text that gets into the page as HTML by mistake
// (a name in a show file, say) can't run as code.

import crypto from "node:crypto";
import path from "node:path";

/** A request's Host and Origin headers (as Node gives them). */
export type AccessHeaders = { host?: string | undefined; origin?: string | undefined };

/**
 * Why a request is refused, or null when it may go on.
 * @param headers the request's Host and Origin
 * @param names the host names (lowercase, no port) this server answers to
 * @param port the port it listens on
 */
export function accessProblem(headers: AccessHeaders, names: ReadonlySet<string>, port: number): string | null {
  const { host, origin } = headers;
  if (!host) return "no Host header";
  const self = parseHost(host);
  if (!self || !names.has(self.name) || self.port !== port) return `unknown host ${host}`;
  if (origin == null) return null;
  let from: URL;
  try {
    from = new URL(origin);
  } catch {
    return `bad origin ${origin}`; // includes "null" (sandboxed pages, file://)
  }
  if (from.protocol !== "http:" || from.host.toLowerCase() !== host.toLowerCase()) return `foreign origin ${origin}`;
  return null;
}

/** "localhost:8080" → { name: "localhost", port: 8080 } (port 80 when none); null if it isn't a host. */
function parseHost(host: string): { name: string; port: number } | null {
  try {
    const url = new URL(`http://${host}`);
    if (url.host.toLowerCase() !== host.toLowerCase() || url.pathname !== "/") return null;
    return { name: url.hostname.toLowerCase(), port: url.port ? Number(url.port) : 80 };
  } catch {
    return null;
  }
}

/** Is `given` (from a request) the server's token? In constant time, so timing can't reveal it a character at a time. */
export function isToken(given: string | null, token: string): boolean {
  if (given == null) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Names this machine always answers to. */
export const LOOPBACK_NAMES = ["localhost", "127.0.0.1", "[::1]"];

/** The app's own files and folders: the only things served (never server/, its data or node_modules). */
export const PUBLIC = ["index.html", "USER-GUIDE.md", "page/", "console/", "stage/", "shared/"];
/** Packages the pages run, served from node_modules under vendor/ (just these folders), so nothing needs the internet: three.js for the stage, marked for the user guide (../page/help.ts). */
export const VENDOR: Readonly<Record<string, string>> = {
  "vendor/three/build/": "node_modules/three/build/",
  "vendor/three/examples/jsm/": "node_modules/three/examples/jsm/",
  "vendor/marked/": "node_modules/marked/lib/",
};

/**
 * The file to serve for a request's path (already URL-decoded, no leading
 * slash), or null when it isn't one of the public files. Checked after the
 * path is resolved, so "page/../server/data/…" (an encoded `..%2f` gets this
 * far) or a backslash can't reach anything else.
 */
export function publicFile(root: string, rel: string): string | null {
  if (rel.includes("\0") || rel.includes("\\")) return null;
  const file = path.resolve(root, rel);
  const inside = path.relative(root, file).split(path.sep).join("/");
  if (inside.startsWith("../") || path.isAbsolute(inside)) return null;
  if (PUBLIC.some((p) => inside === p || (p.endsWith("/") && inside.startsWith(p)))) return file;
  for (const [prefix, dir] of Object.entries(VENDOR)) {
    if (!inside.startsWith(prefix)) continue;
    const target = path.resolve(root, dir, inside.slice(prefix.length));
    return target.startsWith(path.resolve(root, dir) + path.sep) ? target : null;
  }
  return null;
}

/**
 * Where the page may fetch from besides the server: the Open Fixture Library
 * and its files on GitHub (../stage/fixture-library.ts; test/access.test.ts
 * checks this list covers every address there).
 */
export const CONNECT_ORIGINS = ["https://open-fixture-library.org", "https://raw.githubusercontent.com", "https://api.github.com"];

/** Headers for every response: never in another site's frame, types as sent, and no address (with its ?token=) passed on to other sites. */
export const BASE_HEADERS: Readonly<Record<string, string>> = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

/**
 * The Content-Security-Policy for an HTML page, from its own source: the
 * only scripts it runs are the server's files, the page's inline scripts as
 * they are now (by hash: in practice the import maps) and any https address
 * an import map points to (none today: three.js and marked are served from
 * vendor/). Inline event handlers (onerror="…") and javascript: URLs never
 * run. `host`: the Host the page was asked for (already checked), for its
 * WebSocket.
 */
export function contentSecurityPolicy(html: string, host: string): string {
  const scripts = new Set(["'self'"]);
  for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/i.test(attrs)) continue;
    scripts.add(`'sha256-${crypto.createHash("sha256").update(body, "utf8").digest("base64")}'`);
    if (/type\s*=\s*["']?importmap/i.test(attrs)) for (const url of importMapUrls(body)) scripts.add(url);
  }
  return [
    "default-src 'self'",
    `script-src ${[...scripts].join(" ")}`,
    // Inline style attributes are used throughout (colors, bar widths); styles can't run code.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    `connect-src 'self' ws://${host} ${CONNECT_ORIGINS.join(" ")}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** The https addresses an import map points to (a "dir/" entry covers what's under it). */
function importMapUrls(json: string): string[] {
  try {
    const map: unknown = JSON.parse(json);
    const imports = map && typeof map === "object" && "imports" in map ? map.imports : null;
    if (!imports || typeof imports !== "object") return [];
    return Object.values(imports).filter((u): u is string => typeof u === "string" && /^https:\/\/[^\s;,']+$/.test(u));
  } catch {
    return [];
  }
}
