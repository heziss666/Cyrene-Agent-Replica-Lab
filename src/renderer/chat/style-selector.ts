import type { CyreneApi } from "../../shared/electron-api.js";
import type { StyleId } from "../../shared/persona-types.js";

export async function loadSelectedStyle(
  api: CyreneApi["persona"],
): Promise<StyleId> {
  return (await api.getStyle()).styleId;
}

export async function changeSelectedStyle(
  api: CyreneApi["persona"],
  styleId: StyleId,
): Promise<StyleId> {
  return (await api.setStyle(styleId)).styleId;
}
