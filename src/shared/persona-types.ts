export const STYLE_OPTIONS = [
  { id: "default", label: "温柔和善", file: "01_default.md" },
  { id: "lively", label: "元气活泼", file: "02_lively.md" },
  { id: "healing", label: "治愈安心", file: "03_healing.md" },
  { id: "focused", label: "知性认真", file: "04_focused.md" },
  { id: "sweet", label: "撒娇黏人", file: "05_sweet.md" },
] as const;

export type StyleId = (typeof STYLE_OPTIONS)[number]["id"];

export interface StyleTransition {
  from: StyleId;
  to: StyleId;
}

export function isStyleId(value: unknown): value is StyleId {
  return STYLE_OPTIONS.some((option) => option.id === value);
}

export function getStyleOption(styleId: StyleId): (typeof STYLE_OPTIONS)[number] {
  return STYLE_OPTIONS.find((option) => option.id === styleId)!;
}
