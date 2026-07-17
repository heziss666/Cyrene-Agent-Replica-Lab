import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import { parseSkillDocument, MAX_SKILL_BODY_CHARS } from "./skill-frontmatter.js";
import type {
  ScannedSkill,
  SkillDiagnostic,
  ScannedSkillReference,
  SkillScanResult,
  SkillSource,
} from "./skill-types.js";

const SKILL_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const MAX_REFERENCES = 32;
const MAX_REFERENCE_CHARS = 16_000;

function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function diagnostic(
  source: SkillSource,
  path: string,
  code: string,
): SkillDiagnostic {
  return { source, path, code, message: code };
}

async function scanReferences(
  source: SkillSource,
  skillRoot: string,
  diagnostics: SkillDiagnostic[],
): Promise<ScannedSkillReference[]> {
  const referencesRoot = resolve(skillRoot, "references");
  let entries;
  try {
    entries = await readdir(referencesRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    diagnostics.push(diagnostic(source, referencesRoot, "SKILL_REFERENCE_READ_FAILED"));
    return [];
  }

  const references: ScannedSkillReference[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_REFERENCES)) {
    const path = resolve(referencesRoot, entry.name);
    if (entry.isSymbolicLink()) {
      diagnostics.push(diagnostic(source, path, "SKILL_REFERENCE_SYMLINK"));
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      const actual = await realpath(path);
      if (!isInside(skillRoot, actual)) {
        diagnostics.push(diagnostic(source, path, "SKILL_REFERENCE_OUTSIDE_ROOT"));
        continue;
      }
      const content = await readFile(actual, "utf8");
      if (content.length > MAX_REFERENCE_CHARS) {
        diagnostics.push(diagnostic(source, path, "SKILL_REFERENCE_TOO_LARGE"));
        continue;
      }
      references.push({
        name: entry.name,
        path: actual,
        sizeBytes: Buffer.byteLength(content, "utf8"),
        contentHash: contentHash(content),
      });
    } catch {
      diagnostics.push(diagnostic(source, path, "SKILL_REFERENCE_READ_FAILED"));
    }
  }
  if (entries.length > MAX_REFERENCES) {
    diagnostics.push(diagnostic(source, referencesRoot, "SKILL_REFERENCE_LIMIT_EXCEEDED"));
  }
  return references;
}

async function scanRoot(
  rootPath: string,
  source: SkillSource,
  diagnostics: SkillDiagnostic[],
): Promise<ScannedSkill[]> {
  let entries;
  try {
    entries = await readdir(rootPath, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    diagnostics.push(diagnostic(source, rootPath, "SKILL_ROOT_READ_FAILED"));
    return [];
  }

  const rootRealPath = await realpath(rootPath).catch(() => resolve(rootPath));
  const skills: ScannedSkill[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const skillPath = resolve(rootPath, entry.name);
    if (!SKILL_ID_PATTERN.test(entry.name)) {
      diagnostics.push(diagnostic(source, skillPath, "SKILL_ID_INVALID"));
      continue;
    }
    if (entry.isSymbolicLink()) {
      diagnostics.push(diagnostic(source, skillPath, "SKILL_DIRECTORY_SYMLINK"));
      continue;
    }
    if (!entry.isDirectory()) continue;

    const bodyPath = resolve(skillPath, "SKILL.md");
    try {
      const [skillRealPath, bodyInfo] = await Promise.all([realpath(skillPath), lstat(bodyPath)]);
      if (!isInside(rootRealPath, skillRealPath)) throw new Error("SKILL_DIRECTORY_OUTSIDE_ROOT");
      if (bodyInfo.isSymbolicLink() || !bodyInfo.isFile()) throw new Error("SKILL_BODY_INVALID");
      const actualBodyPath = await realpath(bodyPath);
      if (!isInside(skillRealPath, actualBodyPath)) throw new Error("SKILL_BODY_OUTSIDE_ROOT");
      if ((await stat(actualBodyPath)).size > MAX_SKILL_BODY_CHARS * 4) {
        throw new Error("SKILL_BODY_TOO_LARGE");
      }
      const document = await readFile(actualBodyPath, "utf8");
      const parsed = parseSkillDocument(document);
      const references = await scanReferences(source, skillRealPath, diagnostics);
      skills.push({
        id: entry.name,
        name: parsed.name,
        description: parsed.description,
        ...(parsed.version === undefined ? {} : { version: parsed.version }),
        requiredTools: parsed.requiredTools,
        source,
        rootPath: skillRealPath,
        bodyPath: actualBodyPath,
        references,
        defaultEnabled: parsed.defaultEnabled,
        enabled: parsed.defaultEnabled,
        available: true,
        unavailableReasons: [],
        body: parsed.body,
        contentHash: contentHash(document),
      });
    } catch (error) {
      const code = error instanceof Error && /^SKILL_/.test(error.message)
        ? error.message
        : "SKILL_READ_FAILED";
      diagnostics.push(diagnostic(source, skillPath, code));
    }
  }
  return skills;
}

export async function scanSkillRoots(options: {
  builtinRoot: string;
  userRoot: string;
}): Promise<SkillScanResult> {
  const diagnostics: SkillDiagnostic[] = [];
  const builtin = await scanRoot(options.builtinRoot, "builtin", diagnostics);
  const user = await scanRoot(options.userRoot, "user", diagnostics);
  const merged = new Map(builtin.map((skill) => [skill.id, skill]));
  for (const skill of user) merged.set(skill.id, skill);
  return {
    skills: [...merged.values()].sort((a, b) => a.id.localeCompare(b.id)),
    diagnostics,
  };
}
