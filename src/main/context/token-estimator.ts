import type { ChatMessage } from "../../shared/chat-types.js";
import type { ToolSpec } from "../tools/tool-types.js";

export interface TokenEstimator {
  estimateText(text: string): number;
  estimateMessages(messages: ChatMessage[]): number;
  estimateTools(tools: ToolSpec[]): number;
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export function createConservativeTokenEstimator(): TokenEstimator {
  function estimateText(text: string): number {
    let cjk = 0;
    let other = 0;
    for (const character of text) {
      if (/\s/u.test(character)) continue;
      if (CJK.test(character)) cjk += 1;
      else other += 1;
    }
    return cjk + Math.ceil(other / 4);
  }

  return {
    estimateText,
    estimateMessages(messages) {
      return messages.reduce((total, message) => {
        const toolCallTokens = (message.toolCalls ?? []).reduce(
          (sum, call) => sum + 8 + estimateText(call.id) + estimateText(call.name) + estimateText(call.arguments),
          0,
        );
        return total + 4 + estimateText(message.role) + estimateText(message.content)
          + estimateText(message.name ?? "") + estimateText(message.toolCallId ?? "") + toolCallTokens;
      }, 0);
    },
    estimateTools(tools) {
      return tools.reduce(
        (total, tool) => total + 12 + estimateText(tool.name) + estimateText(tool.description)
          + estimateText(JSON.stringify(tool.parameters)),
        0,
      );
    },
  };
}
