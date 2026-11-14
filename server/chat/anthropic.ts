// The chat's Anthropic (Claude) adapter: turns the chat's messages and
// tools (shared/chat-protocol.ts) into a Messages API call and its reply
// back. Credentials: ANTHROPIC_API_KEY, or a profile from `ant auth login`.

import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlock, BetaContentBlockParam, BetaMessage, BetaMessageParam, BetaTool, BetaToolUnion } from "@anthropic-ai/sdk/resources/beta/messages";
import type { ChatAssistantMessage, ChatMessage, ChatModelChoice, ChatServerTool, ChatTool, ChatToolCall, ChatUsage } from "../../shared/chat-protocol.ts";
import { isOneOf, isRecord } from "../../shared/guards.ts";
import type { ChatModel } from "./model.ts";

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORTS)[number];

const PROVIDER = "anthropic";

/**
 * The models the chat panel's menu offers (the default first). `fallback`:
 * the API may rerun a declined request on another model (server-side
 * fallback); Haiku has none.
 */
export const MODELS: (ChatModelChoice & { fallback: boolean })[] = [
  { id: "claude-opus-5-5", name: "Claude Opus 5.5", note: "Default · smart and quick", fallback: true },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", note: "Faster, cheaper", fallback: true },
  { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", note: "Fastest, cheapest", fallback: false },
  { id: "claude-fable-5-2", name: "Claude Fable 5.2", note: "Most capable, slower, costs most", fallback: true },
];
/** A reply's blocks, as the API sent them (passed back unchanged). */
const isBlocks = (v: unknown): v is BetaContentBlockParam[] => Array.isArray(v) && v.every(isRecord);

export function toApiMessage(m: ChatMessage): BetaMessageParam {
  switch (m.role) {
    case "summary":
      return { role: "user", content: `(Summary of the earlier part of this chat)\n${m.text}` };
    case "user":
      return { role: "user", content: m.text || "…" };
    case "tool":
      return {
        role: "user",
        content: m.results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.result, is_error: r.error ?? false })),
      };
    case "assistant": {
      if (m.raw?.provider === PROVIDER && isBlocks(m.raw.data) && m.raw.data.length) return { role: "assistant", content: m.raw.data };
      const content: BetaContentBlockParam[] = [];
      if (m.text) content.push({ type: "text", text: m.text });
      for (const c of m.toolCalls) content.push({ type: "tool_use", id: c.id, name: c.name, input: c.args });
      return { role: "assistant", content: content.length ? content : "…" };
    }
  }
}

/**
 * The tools as the API takes them. Deferred ones (ChatTool.deferred) are
 * declared with `defer_loading`, so the model doesn't read them on every
 * request: it finds them with the API's tool search when it needs one.
 * They're also outside thinking blocks' binding until used, so tools added
 * later this way don't drop the model's earlier reasoning.
 */
export function toApiTools(tools: ChatTool[]): BetaToolUnion[] | undefined {
  if (!tools.length) return undefined;
  const list: BetaToolUnion[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.schema as BetaTool.InputSchema,
    ...(t.deferred ? { defer_loading: true } : {}),
  }));
  if (tools.some((t) => t.deferred)) list.unshift({ type: "tool_search_tool_bm25_20251119", name: "tool_search_tool_bm25" });
  return list;
}

/** The tools the API ran itself in a reply (tool search: what it looked for, which tools it found). */
export function serverTools(content: BetaContentBlock[]): ChatServerTool[] {
  const out: ChatServerTool[] = [];
  const byId = new Map<string, ChatServerTool>();
  for (const b of content) {
    if (b.type === "server_tool_use") {
      const q = isRecord(b.input) ? (b.input.query ?? b.input.pattern) : undefined;
      const t: ChatServerTool = { name: b.name, input: typeof q === "string" ? q : JSON.stringify(b.input), result: "" };
      byId.set(b.id, t);
      out.push(t);
    } else if (b.type === "tool_search_tool_result") {
      const t = byId.get(b.tool_use_id);
      if (!t) continue;
      const c = b.content;
      t.result = c.type === "tool_search_tool_search_result" ? c.tool_references.map((r) => r.tool_name).join(", ") || "nothing found" : `failed (${c.error_code})`;
    }
  }
  return out;
}

/** Most times a reply paused by the API's own tool loop (tool search) is resumed. */
const MAX_RESUMES = 3;

/** A failed call, said so the person at the console knows what to do. */
function explain(err: unknown): Error {
  if (err instanceof Anthropic.AuthenticationError || (err instanceof Anthropic.AnthropicError && /api ?key|auth/i.test(err.message))) {
    return new Error("No working Anthropic credentials: set ANTHROPIC_API_KEY (or run `ant auth login`) and restart the show server");
  }
  if (err instanceof Anthropic.RateLimitError) return new Error("Rate limited by the Anthropic API: try again in a moment");
  if (err instanceof Anthropic.APIConnectionError) return new Error("Can't reach the Anthropic API (is this computer online?)");
  if (err instanceof Anthropic.APIError) return new Error(`Anthropic API error ${err.status ?? ""}: ${err.message}`);
  return err instanceof Error ? err : new Error(String(err));
}

/** `model`: the default (UNNATURALLIGHT_CHAT_MODEL); one not in MODELS is added to the menu, first. */
export function createAnthropicModel(opts: { model?: string | undefined; effort?: string | undefined }): ChatModel {
  const defaultModel = opts.model || MODELS[0].id;
  const known = MODELS.find((m) => m.id === defaultModel);
  const models = known
    ? [known, ...MODELS.filter((m) => m !== known)]
    : [{ id: defaultModel, name: defaultModel, note: "Default (UNNATURALLIGHT_CHAT_MODEL)", fallback: false }, ...MODELS];
  const effort: Effort = isOneOf(EFFORTS, opts.effort) ? opts.effort : "low";
  let client: Anthropic | null = null;

  return {
    models: models.map(({ id, name, note }) => ({ id, name, note })),
    defaultModel,
    label: (model) => `${PROVIDER} · ${model}`,
    async reply({ model: picked, system, messages, tools, onText, signal }): Promise<ChatAssistantMessage> {
      const choice = models.find((m) => m.id === picked) ?? models[0];
      const model = choice.id;
      let msg: BetaMessage;
      // A reply can come in parts: the API pauses its own tool loop (tool
      // search) now and then, and is resumed by sending the reply so far.
      const content: BetaContentBlock[] = [];
      const usage: ChatUsage = { model, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      try {
        client ??= new Anthropic();
        const apiMessages = messages.map(toApiMessage);
        const apiTools = toApiTools(tools);
        for (let resume = 0; ; resume++) {
          const stream = client.beta.messages.stream(
            {
              model,
              max_tokens: 16000,
              system,
              messages: content.length ? [...apiMessages, { role: "assistant", content: [...content] }] : apiMessages,
              ...(apiTools ? { tools: apiTools } : {}),
              output_config: { effort },
              // Claude's thinking blocks are tied to the system prompt, tools and
              // earlier messages they were made with. A saved conversation outlives
              // those (the prompt or tools change in an update; the panel drops its
              // oldest messages), so let the API drop blocks that no longer match
              // instead of failing the request. Only the model's past reasoning is
              // lost; what it said and did stays.
              // Blocks from another model (the person picked a different one
              // mid-chat) are dropped the same way, by the API.
              thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
              cache_control: { type: "ephemeral" },
              // If the model declines, the API retries on a fallback model (where it has one).
              ...(choice.fallback
                ? { betas: ["thinking-binding-controls-2026-08-01", "server-side-fallback-2026-07-01"], fallbacks: "default" as const }
                : { betas: ["thinking-binding-controls-2026-08-01"] }),
            },
            { signal },
          );
          stream.on("text", (text) => onText(text));
          msg = await stream.finalMessage();
          content.push(...msg.content);
          usage.model = msg.model;
          usage.input += msg.usage.input_tokens;
          usage.output += msg.usage.output_tokens;
          usage.cacheRead += msg.usage.cache_read_input_tokens ?? 0;
          usage.cacheWrite += msg.usage.cache_creation_input_tokens ?? 0;
          if (msg.stop_reason !== "pause_turn" || resume >= MAX_RESUMES) break;
        }
      } catch (err) {
        throw explain(err);
      }
      if (msg.stop_reason === "refusal") throw new Error("The model declined this request");

      let text = "";
      const toolCalls: ChatToolCall[] = [];
      for (const b of content) {
        if (b.type === "text") text += b.text;
        else if (b.type === "tool_use") toolCalls.push({ id: b.id, name: b.name, args: isRecord(b.input) ? b.input : {} });
      }
      // Cut off mid-call (max_tokens): drop the calls; their inputs may be incomplete.
      const cut = msg.stop_reason === "max_tokens";
      const data = cut ? content.filter((b) => b.type !== "tool_use") : content;
      const found = serverTools(content);
      return {
        role: "assistant",
        text,
        toolCalls: cut ? [] : toolCalls,
        usage,
        ...(found.length ? { serverTools: found } : {}),
        raw: { provider: PROVIDER, data },
      };
    },
  };
}
