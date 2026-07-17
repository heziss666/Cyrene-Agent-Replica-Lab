export type SkillSource = "builtin" | "user";

export interface SkillReference {
  name: string;
  path: string;
  sizeBytes: number;
}

export interface SkillEntry {
  id: string;
  name: string;
  description: string;
  version?: string;
  requiredTools: string[];
  source: SkillSource;
  rootPath: string;
  bodyPath: string;
  references: SkillReference[];
  defaultEnabled: boolean;
  enabled: boolean;
  available: boolean;
  unavailableReasons: string[];
}

export interface ScannedSkillReference extends SkillReference {
  contentHash: string;
}

export interface ScannedSkill extends Omit<SkillEntry, "references"> {
  references: ScannedSkillReference[];
  body: string;
  contentHash: string;
}

export interface SkillDiagnostic {
  source: SkillSource;
  path: string;
  code: string;
  message: string;
}

export interface SkillScanResult {
  skills: ScannedSkill[];
  diagnostics: SkillDiagnostic[];
}

export interface ParsedSkillDocument {
  name: string;
  description: string;
  version?: string;
  requiredTools: string[];
  defaultEnabled: boolean;
  body: string;
}
