import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const htmlPath = new URL("../../src/renderer/chat/index.html", import.meta.url);
const cssPath = new URL("../../src/renderer/chat/style.css", import.meta.url);

describe("renderer workspace shell", () => {
  it("provides the sidebar, page header, and collapsed activity drawer", async () => {
    const html = await readFile(htmlPath, "utf8");

    expect(html).toContain('class="app-sidebar"');
    expect(html).toContain('id="page-title"');
    expect(html).toContain('id="activity-toggle"');
    expect(html).toContain('id="activity-drawer"');
    expect(html).toContain('id="activity-drawer" class="activity-drawer" aria-hidden="true" hidden');
  });

  it("provides a dedicated currency war game workspace", async () => {
    const html = await readFile(htmlPath, "utf8");
    const css = await readFile(cssPath, "utf8");

    expect(html).toContain('id="currency-war-view-button"');
    expect(html).toContain('id="currency-war-view"');
    expect(css).toContain(".game-state-grid");
    expect(css).toContain(".game-state-section");
  });

  it("defines the calm theme and responsive application layout", async () => {
    const css = await readFile(cssPath, "utf8");

    expect(css).toContain("--accent: #2f6f55");
    expect(css).toContain("grid-template-columns: var(--sidebar-width) minmax(0, 1fr)");
    expect(css).toContain("position: sticky");
    expect(css).toContain(".activity-drawer.is-open");
    expect(css).toContain("@media (max-width: 860px)");
  });
});
