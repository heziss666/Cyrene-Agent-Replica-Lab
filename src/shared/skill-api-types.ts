export interface SkillListItem {
  id: string;
  name: string;
  description: string;
  version?: string;
  requiredTools: string[];
  source: "builtin" | "user";
  references: string[];
  defaultEnabled: boolean;
  enabled: boolean;
  available: boolean;
  unavailableReasons: string[];
}

export interface SkillDiagnosticItem {
  source: "builtin" | "user";
  code: string;
  message: string;
}

export interface SkillsSnapshot {
  skills: SkillListItem[];
  diagnostics: SkillDiagnosticItem[];
}

export interface SkillsApi {
  list(): Promise<SkillsSnapshot>;
  setEnabled(id: string, enabled: boolean): Promise<SkillsSnapshot>;
  reload(): Promise<SkillsSnapshot>;
}
