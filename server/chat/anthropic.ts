// The chat's Anthropic (Claude) adapter: turns the chat's messages and
// tools (shared/chat-protocol.ts) into a Messages API call and its reply
// back. Credentials: ANTHROPIC_API_KEY, or a profile from `ant auth login`.

import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlock, BetaContentBlockParam, BetaMessage, BetaMessageParam, BetaTool, BetaToolUnion } from "@anthropic-ai/sdk/resources/beta/messages";
import type { ChatAssistantMessage, ChatMessage, ChatTool, ChatToolCall } from "../../shared/chat-protocol.ts";
import { isOneOf, isRecord } from "../../shared/guards.ts";
import type { ChatModel } from "./model.ts";

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORTS)[number];

const PROVIDER = "anthropic";
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

export function createAnthropicModel(opts: { model?: string | undefined; effort?: string | undefined }): ChatModel {
  const model = opts.model || "claude-opus-5-5";
  const effort: Effort = isOneOf(EFFORTS, opts.effort) ? opts.effort : "low";
  let client: Anthropic | null = null;

  return {
    label: `${PROVIDER} · ${model}`,
    async reply({ system, messages, tools, onText, signal }): Promise<ChatAssistantMessage> {
      let msg: BetaMessage;
      // A reply can come in parts: the API pauses its own tool loop (tool
      // search) now and then, and is resumed by sending the reply so far.
      const content: BetaContentBlock[] = [];
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
              thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
              cache_control: { type: "ephemeral" },
              betas: [
                "thinking-binding-controls-2026-08-01",
                // If the model declines, the API retries on a fallback model.
                "server-side-fallback-2026-07-01",
              ],
              fallbacks: "default",
            },
            { signal },
          );
          stream.on("text", (text) => onText(text));
          msg = await stream.finalMessage();
          content.push(...msg.content);
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
      return { role: "assistant", text, toolCalls: cut ? [] : toolCalls, raw: { provider: PROVIDER, data } };
    },
  };
}
