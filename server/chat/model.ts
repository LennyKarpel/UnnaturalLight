// A chat model provider, behind one interface: the only part of the chat
// that knows which provider answers. Add a provider by writing another
// adapter (like ./anthropic.ts) and picking it in pickModel.

import type { ChatAssistantMessage, ChatMessage, ChatTool } from "../../shared/chat-protocol.ts";
import { createAnthropicModel } from "./anthropic.ts";

export interface ChatModel {
  /** e.g. "anthropic · claude-opus-5-5" */
  readonly label: string;
  /**
   * One model reply to the conversation so far: its text arrives through
   * `onText` as it's written; resolves with the whole reply (and any tool
   * calls it wants made).
   */
  reply(opts: {
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
 *   UNNATURALLIGHT_CHAT_MODEL     the provider's model id
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
