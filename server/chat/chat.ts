// POST /chat: one model reply for the chat panel (page/chat/). The page
// sends the conversation and its tools (shared/chat-protocol.ts); this asks
// the model (./model.ts) and streams its reply back, one JSON event per
// line. The tools run in the page, which calls again with their results.
//
// POST /chat/summary: the panel's older messages, summed up in a few lines,
// so a long chat stays short to send (the summary replaces them).

import type http from "node:http";
import type { ChatEvent, ChatMessage, ChatRequest, ChatSummary, ChatTool } from "../../shared/chat-protocol.ts";
import { errorMessage, isRecord } from "../../shared/guards.ts";
import { pickModel, type ChatModel } from "./model.ts";

const MAX_BODY = 4 * 1024 * 1024;

export const SYSTEM_PROMPT = `You are the assistant built into UnnaturalLight, a lighting console and 3D stage for live shows. The person talking to you is running the lights, often during rehearsal or a show, so keep replies short: one or two sentences, plain text, no markdown headings.

Terms:
- fixture: a light.
- show: everything in the show file — all songs, sets, fixtures and patch.
- song: a list of cues. Cues are numbered from 1 within their song.
- set: an ordered list of songs for one event; GO runs on into the next set song.
- cue: a stored look (a level for each fader).
- LIVE: the cue on stage now. UP NEXT: the cue GO fades to (the next cue, or the next set song's first).
- transition: GO fades from LIVE to UP NEXT over UP NEXT's fade time.
- master: overall level, 0–100%. crossfader: 0 = all LIVE, 100 = all UP NEXT.
- fader: one of 256 sliders; a cue stores a level (0–255) for each. Faders drive DMX channels; a fixture's channels each do one thing (dimmer, pan, tilt, red, green, blue, white, amber, zoom, …).

Use the tools to see and change the show; never guess what's in it — call get_show, get_cue, list_fixtures or get_stage when you need to know. Some tools may only show up when you search for them (editing cues and songs, fixture settings, the stage). Making a cue LIVE by selecting it jumps straight there (no fade); GO fades.

Editing: a change to the LIVE cue shows on stage at once; other cues change what they'll look like when played. Edits go into the LIVE cue unless the person names another. For a fixture's brightness, color or pan / tilt use set_fixture (dimmer in %, color as #rrggbb); use set_cue_levels for faders by number. "Brighter" or "dimmer" without a number: change it by about 20 percentage points. After editing, say in a few words what changed.

The stage: a 3D box with the fixtures placed in it (meters, origin at the floor's center; x: stage right − to stage left +, y: up, z: upstage − to downstage/audience +). Stage right and left are from the performers' view, facing the audience. Tools always take and give meters, but get_stage's units says what the person sees: when it's feet, talk to them in feet (1 ft = 0.3048 m) and convert what they say. A rig is a group of fixtures in a circle, square or line that move together. Named positions are spots the person saved on the stage (e.g. "DSC", "drum riser"), like a console's position presets: when they say to aim at one, use aim_fixtures with position. Risers are boxes standing on the floor (platforms, a drum riser): something on a riser stands at its height, so a spot on its top has y = the riser's height. Fixtures aimed at a position follow it, and so does every cue that aims at it, so moving the position re-aims them all. Placing a fixture usually also adds it to the console with faders. To point lights somewhere use aim_fixtures; set_fixture's pan / tilt are raw 0–255 values.

Do what's asked straight away — don't ask for confirmation first (the person can undo a request's edits with the Undo button in the chat). If no tool can do what's asked, say so plainly.`;

export function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("Chat request too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const isTool = (t: unknown): t is ChatTool =>
  isRecord(t) && typeof t.name === "string" && typeof t.description === "string" && isRecord(t.schema) && (t.deferred == null || typeof t.deferred === "boolean");
export const isMessage = (m: unknown): m is ChatMessage =>
  isRecord(m) &&
  (((m.role === "user" || m.role === "summary") && typeof m.text === "string") ||
    (m.role === "assistant" && typeof m.text === "string" && Array.isArray(m.toolCalls)) ||
    (m.role === "tool" && Array.isArray(m.results)));

/** Check what the page sent (it's parsed JSON from a browser). */
export function parseChatRequest(body: unknown): ChatRequest {
  if (!isRecord(body) || !Array.isArray(body.messages) || !Array.isArray(body.tools)) throw new Error("Bad chat request");
  if (!body.messages.length || !body.messages.every(isMessage)) throw new Error("Bad chat messages");
  if (!body.tools.every(isTool)) throw new Error("Bad chat tools");
  return { messages: body.messages, tools: body.tools };
}

let model: ChatModel | null = null;

export const SUMMARY_PROMPT = `You summarize the start of a conversation between a lighting operator and the assistant in UnnaturalLight (a lighting console with songs, cues, sets, GO, LIVE and UP NEXT). The summary replaces those messages, so the assistant can carry on without them.

Write at most 8 short lines of plain text: what the operator asked for and what was done (or failed), names or nicknames they gave things ("the blue wash" = Song 2 cue 3), and preferences or instructions that should still apply. Leave out greetings, the assistant's explanations and what the show looked like at the time (the assistant checks the show itself). No headings, no markdown.`;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** The messages as plain text for the summarizer (no provider blocks, tool results cut short). */
export function transcript(messages: ChatMessage[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role === "summary") lines.push(`Summary of what came before: ${m.text}`);
    else if (m.role === "user") lines.push(`Operator: ${m.text}`);
    else if (m.role === "assistant") {
      if (m.text) lines.push(`Assistant: ${m.text}`);
      for (const c of m.toolCalls) lines.push(`Assistant used ${c.name}${Object.keys(c.args).length ? ` ${JSON.stringify(c.args)}` : ""}`);
    } else for (const r of m.results) lines.push(`${r.error ? "Tool failed" : "Tool result"}: ${clip(r.result, 300)}`);
  }
  return lines.join("\n");
}

export async function handleChatSummary(req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" }).end("POST only");
    return;
  }
  let messages: ChatMessage[];
  try {
    const body: unknown = JSON.parse(await readBody(req));
    if (!isRecord(body) || !Array.isArray(body.messages) || !body.messages.length || !body.messages.every(isMessage)) throw new Error("Bad summary request");
    messages = body.messages;
  } catch (err) {
    res.writeHead(400).end(errorMessage(err, "Bad summary request"));
    return;
  }
  const abort = new AbortController();
  res.on("close", () => abort.abort());
  try {
    model ??= pickModel();
    const reply = await model.reply({
      system: SUMMARY_PROMPT,
      messages: [{ role: "user", text: `Summarize this:\n\n${transcript(messages)}` }],
      tools: [],
      onText: () => {},
      signal: abort.signal,
    });
    const out: ChatSummary = { summary: reply.text.trim() };
    if (!out.summary) throw new Error("Empty summary");
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(out));
  } catch (err) {
    if (!abort.signal.aborted) res.writeHead(502).end(errorMessage(err, "Summary failed"));
  }
}

export async function handleChat(req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" }).end("POST only");
    return;
  }
  let chat: ChatRequest;
  try {
    chat = parseChatRequest(JSON.parse(await readBody(req)));
  } catch (err) {
    res.writeHead(400).end(errorMessage(err, "Bad chat request"));
    return;
  }
  res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" });
  const send = (e: ChatEvent) => res.write(`${JSON.stringify(e)}\n`);
  // The page gave up (closed, or Stop): stop the model too.
  const abort = new AbortController();
  res.on("close", () => abort.abort());
  try {
    model ??= pickModel();
    const message = await model.reply({
      system: SYSTEM_PROMPT,
      messages: chat.messages,
      tools: chat.tools,
      onText: (text) => send({ type: "text", text }),
      signal: abort.signal,
    });
    send({ type: "done", message, model: model.label });
  } catch (err) {
    if (!abort.signal.aborted) send({ type: "error", error: errorMessage(err, "Chat failed") });
  }
  res.end();
}
