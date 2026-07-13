import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadMarkdownKnowledgeDirectory,
  parseMarkdownKnowledge,
} from "../../src/main/rag/markdown-knowledge-loader.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("parseMarkdownKnowledge", () => {
  it("splits H2 sections and assigns deterministic duplicate ids", () => {
    const input = {
      relativePath: "worldbook/Cyrene.md",
      markdown: [
        "# Cyrene",
        "File context.",
        "",
        "## First Form",
        "- 触发词: core",
        "",
        "Body A",
        "",
        "## First Form",
        "Body B",
      ].join("\n"),
      collection: "cyrene-worldbook",
    };

    const first = parseMarkdownKnowledge(input);
    const second = parseMarkdownKnowledge(input);

    expect(first).toEqual(second);
    expect(first).toEqual([
      {
        id: "worldbook_cyrene_first-form",
        title: "First Form",
        source: "worldbook/Cyrene.md",
        text: "# Cyrene\nFile context.\n\n## First Form\n- 触发词: core\n\nBody A",
        metadata: {
          collection: "cyrene-worldbook",
          file: "Cyrene.md",
          section: "First Form",
        },
      },
      {
        id: "worldbook_cyrene_first-form-2",
        title: "First Form",
        source: "worldbook/Cyrene.md",
        text: "# Cyrene\nFile context.\n\n## First Form\nBody B",
        metadata: {
          collection: "cyrene-worldbook",
          file: "Cyrene.md",
          section: "First Form",
        },
      },
    ]);
  });

  it("normalizes CRLF and preserves Chinese glossary headings", () => {
    const documents = parseMarkdownKnowledge({
      relativePath: "worldbook/_glossary.md",
      markdown: "# 称谓\r\n\r\n## 伙伴 = 用户\r\n说明文字\r\n",
      collection: "cyrene-worldbook",
    });

    expect(documents).toEqual([
      expect.objectContaining({
        id: "worldbook_glossary_伙伴-用户",
        title: "伙伴 = 用户",
        text: "# 称谓\n\n## 伙伴 = 用户\n说明文字",
      }),
    ]);
  });

  it("uses the whole file when no H2 section exists", () => {
    expect(parseMarkdownKnowledge({
      relativePath: "canon_quotes.md",
      markdown: "# Canon Quotes\n\nA remembered line.",
      collection: "cyrene-worldbook",
    })).toEqual([
      expect.objectContaining({
        id: "canon-quotes",
        title: "Canon Quotes",
        text: "# Canon Quotes\n\nA remembered line.",
      }),
    ]);
  });

  it("ignores empty H2 sections", () => {
    expect(parseMarkdownKnowledge({
      relativePath: "worldbook/empty.md",
      markdown: "# Empty\n\n## Nothing\n\n## Real\nBody",
      collection: "cyrene-worldbook",
    }).map((document) => document.title)).toEqual(["Real"]);
  });
});

describe("loadMarkdownKnowledgeDirectory", () => {
  it("loads Markdown files in stable filename order", () => {
    const directory = mkdtempSync(join(tmpdir(), "cyrene-markdown-loader-"));
    directories.push(directory);
    writeFileSync(join(directory, "b.md"), "# B\n\nText B", "utf8");
    writeFileSync(join(directory, "a.md"), "# A\n\nText A", "utf8");
    writeFileSync(join(directory, "ignored.txt"), "ignored", "utf8");

    const documents = loadMarkdownKnowledgeDirectory({
      directory,
      sourcePrefix: "worldbook",
      collection: "cyrene-worldbook",
    });

    expect(documents.map((document) => document.source)).toEqual([
      "worldbook/a.md",
      "worldbook/b.md",
    ]);
  });
});
