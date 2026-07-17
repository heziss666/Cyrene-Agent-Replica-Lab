import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseSkillDocument } from "./skill-frontmatter.js";
import { scanSkillRoots } from "./skill-scanner.js";
import type { SkillSettingsStore } from "./skill-settings-store.js";
import type {
  ScannedSkill,
  SkillDiagnostic,
  SkillEntry,
} from "./skill-types.js";

export interface SkillRegistrySnapshot {
  skills: SkillEntry[];
  diagnostics: SkillDiagnostic[];
}

export interface SkillRegistryOptions {
  builtinRoot: string;
  userRoot: string;
  settingsStore: SkillSettingsStore;
  getToolIds?: () => string[];
}

function publicEntry(skill: ScannedSkill): SkillEntry {
  const { body: _body, contentHash: _contentHash, references, ...entry } = skill;
  return structuredClone({
    ...entry,
    references: references.map(({ contentHash: _hash, ...reference }) => reference),
  });
}

function hash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export class SkillRegistry {
  private skills = new Map<string, ScannedSkill>();
  private diagnostics: SkillDiagnostic[] = [];
  private enabledById: Record<string, boolean> = {};
  private getToolIds: () => string[];
  private reloadTail = Promise.resolve();

  constructor(private readonly options: SkillRegistryOptions) {
    this.getToolIds = options.getToolIds ?? (() => []);
  }

  setToolIdsProvider(provider: () => string[]): void {
    this.getToolIds = provider;
  }

  async initialize(): Promise<void> {
    this.enabledById = await this.options.settingsStore.load();
    await this.reload();
  }

  reload(): Promise<void> {
    const operation = this.reloadTail.then(async () => {
      const result = await scanSkillRoots({
        builtinRoot: this.options.builtinRoot,
        userRoot: this.options.userRoot,
      });
      const toolIds = new Set(this.getToolIds());
      const next = new Map<string, ScannedSkill>();
      for (const scanned of result.skills) {
        const unavailableReasons = scanned.requiredTools
          .filter((id) => !toolIds.has(id))
          .map((id) => `Missing tool: ${id}`);
        next.set(scanned.id, {
          ...scanned,
          enabled: this.enabledById[scanned.id] ?? scanned.defaultEnabled,
          available: unavailableReasons.length === 0,
          unavailableReasons,
        });
      }
      this.skills = next;
      this.diagnostics = result.diagnostics;
    });
    this.reloadTail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  list(): SkillEntry[] {
    return [...this.skills.values()].map(publicEntry);
  }

  snapshot(): SkillRegistrySnapshot {
    return {
      skills: this.list(),
      diagnostics: structuredClone(this.diagnostics),
    };
  }

  get(id: string): SkillEntry | undefined {
    const skill = this.skills.get(id);
    return skill ? publicEntry(skill) : undefined;
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const skill = this.skills.get(id);
    if (!skill) throw new Error("SKILL_NOT_FOUND");
    const next = { ...this.enabledById, [id]: enabled };
    await this.options.settingsStore.save(next);
    this.enabledById = next;
    skill.enabled = enabled;
  }

  async readBody(id: string): Promise<string> {
    const skill = this.requireUsable(id);
    const document = await readFile(skill.bodyPath, "utf8");
    if (hash(document) !== skill.contentHash) throw new Error("SKILL_CHANGED_SINCE_SCAN");
    const parsed = parseSkillDocument(document);
    return skill.body;
  }

  async readReference(id: string, name: string): Promise<string> {
    const skill = this.requireUsable(id);
    const reference = skill.references.find((item) => item.name === name);
    if (!reference) throw new Error("SKILL_REFERENCE_NOT_FOUND");
    const content = await readFile(reference.path, "utf8");
    if (Buffer.byteLength(content, "utf8") !== reference.sizeBytes
      || hash(content) !== reference.contentHash) {
      throw new Error("SKILL_CHANGED_SINCE_SCAN");
    }
    return content;
  }

  private requireUsable(id: string): ScannedSkill {
    const skill = this.skills.get(id);
    if (!skill) throw new Error("SKILL_NOT_FOUND");
    if (!skill.enabled) throw new Error("SKILL_DISABLED");
    if (!skill.available) throw new Error("SKILL_UNAVAILABLE");
    return skill;
  }
}
