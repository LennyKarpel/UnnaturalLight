/**
 * The chat panel's messages (../page/chat/) and the show server's `/chat`
 * route (../server/chat/): our own format, not any model provider's, so the
 * page never knows which provider answers. Only the server's adapter
 * (server/chat/anthropic.ts, …) turns these into a provider's API calls.
 *
 * The tools run in the page (they call the console and stage): the server
 * only passes their descriptions to the model and hands back the calls it
 * wants made.
 */

/**
 * A tool the model may call: its JSON Schema says what `args` it takes.
 * `deferred`: not needed often, so a provider that can may keep it out of the
 * model's view until the model searches for it (Claude's tool search);
 * others just send it with the rest.
 */
export type ChatTool = { name: string; description: string; schema: Record<string, unknown>; deferred?: boolean | undefined };

export type ChatToolCall = { id: string; name: string; args: Record<string, unknown> };

export type ChatToolResult = { id: string; result: string; error?: boolean };

export type ChatAssistantMessage = {
  role: "assistant";
  text: string;
  toolCalls: ChatToolCall[];
  /**
   * The reply exactly as the provider sent it. Passed back unchanged, so the
   * same provider gets its own blocks back (e.g. Claude's thinking blocks);
   * another provider ignores it and uses `text` / `toolCalls`.
   */
  raw?: { provider: string; data: unknown };
};

export type ChatMessage =
  /** What earlier messages said, in short (always the first message: it replaces them). */
  | { role: "summary"; text: string }
  | { role: "user"; text: string }
  | ChatAssistantMessage
  /** The results of every tool call in the assistant message before it. */
  | { role: "tool"; results: ChatToolResult[] };

/** Page → server (POST /chat, JSON). */
export type ChatRequest = { messages: ChatMessage[]; tools: ChatTool[] };

/** Page → server (POST /chat/summary, JSON): the messages to sum up. Answer: ChatSummary. */
export type ChatSummaryRequest = { messages: ChatMessage[] };
export type ChatSummary = { summary: string };

/**
 * One chat (conversation) as the show server keeps it (server/data/session.chats.json).
 * `name` is "" until the first prompt names it; `used`: when it was last sent to (ms).
 */
export type SavedChat = { id: string; name: string; history: ChatMessage[]; used: number };
/** GET /chat/chats: every chat. PUT /chat/chats/<id> (a SavedChat) saves one; DELETE removes it. Each has its own id, so a window only ever takes a chat's messages by that id. */
export type SavedChats = { chats: SavedChat[] };
/**
 * GET /chat/chats/events?window=<id> (server-sent events): each `data:` line is
 * one ChatChange, as another window saves or deletes a chat, or a new or
 * loaded show replaces them all (`replaced`, to every window). A PUT or DELETE
 * with ?window=<id> isn't sent back to that window.
 */
export type ChatChange = { type: "saved"; chat: SavedChat } | { type: "deleted"; id: string } | { type: "replaced"; chats: SavedChat[] };
export const MAX_CHATS = 30;
export const CHAT_NAME_MAX = 40;

/** Server → page: one JSON object per line, as the reply streams in. */
export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "done"; message: ChatAssistantMessage; model: string }
  | { type: "error"; error: string };
