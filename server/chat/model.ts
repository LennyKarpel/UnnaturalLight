// A chat model provider, behind one interface: the only part of the chat
// that knows which provider answers. Add a provider by writing another
// adapter (like ./anthropic.ts) and picking it in pickModel.

import type { ChatAssistantMessage, ChatMessage, ChatModelChoice, ChatTool } from "../../shared/chat-protocol.ts";
import { createAnthropicModel } from "./anthropic.ts";

export interface ChatModel {
  /** The models the chat panel may pick from (its model menu), the default first. */
  readonly models: ChatModelChoice[];
  /** The model used when the page doesn't pick one (one of `models`). */
  readonly defaultModel: string;
  /** What the panel shows for a model, e.g. "anthropic · claude-opus-5-5". */
  label(model: string): string;
  /**
   * One model reply to the conversation so far: its text arrives through
   * `onText` as it's written; resolves with the whole reply (and any tool
   * calls it wants made). `model`: one of `models` (else the default).
   */
  reply(opts: {
    model?: string | undefined;
    system: string;
    messages: ChatMessage[];
    tools: ChatTool[];
    onText: (text: string) => void;
    signal: AbortSignal;
  }): Promise<ChatAssistantMessage>;
}

/**
 * The provider and model, from the environment:
 *   UNNATURALLIGHT_CHAT_PROVIDER  anthropic (default; the only one so far)
 *   UNNATURALLIGHT_CHAT_MODEL     the provider's model id to start with (the panel's menu can pick another)
 *   UNNATURALLIGHT_CHAT_EFFORT    how hard it thinks (Anthropic: low … max; default low)
 */
export function pickModel(env = process.env): ChatModel {
  const provider = env.UNNATURALLIGHT_CHAT_PROVIDER ?? "anthropic";
  switch (provider) {
    case "anthropic":
      return createAnthropicModel({ model: env.UNNATURALLIGHT_CHAT_MODEL, effort: env.UNNATURALLIGHT_CHAT_EFFORT });
    default:
      throw new Error(`Unknown chat provider "${provider}" (UNNATURALLIGHT_CHAT_PROVIDER)`);
  }
}
