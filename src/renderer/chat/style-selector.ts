import type { CyreneApi } from "../../shared/electron-api.js";
import type { StyleId } from "../../shared/persona-types.js";

export async function loadSelectedStyle(
  api: CyreneApi["persona"],
  conversationId: string,
): Promise<StyleId> {
  return (await api.getStyle(conversationId)).styleId;
}

export async function changeSelectedStyle(
  api: CyreneApi["persona"],
  conversationId: string,
  styleId: StyleId,
): Promise<StyleId> {
  return (await api.setStyle(conversationId, styleId)).styleId;
}
