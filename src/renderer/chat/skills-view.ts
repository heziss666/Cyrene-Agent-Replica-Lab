import type { SkillsApi, SkillsSnapshot } from "../../shared/skill-api-types.js";
import { skillStatusLabel, sortSkillItems } from "./skills-view-model.js";

export interface SkillsViewController {
  show(): Promise<void>;
}

export function mountSkillsView(options: {
  root: HTMLElement;
  api: SkillsApi;
  document?: Document;
}): SkillsViewController {
  const document = options.document ?? window.document;
  const header = document.createElement("header");
  header.className = "skills-header";
  const heading = document.createElement("h2");
  heading.textContent = "Skills";
  const reloadButton = document.createElement("button");
  reloadButton.type = "button";
  reloadButton.className = "secondary-button";
  reloadButton.textContent = "Reload";
  header.append(heading, reloadButton);

  const status = document.createElement("p");
  status.className = "skills-status";
  const content = document.createElement("div");
  content.className = "skills-content";
  options.root.replaceChildren(header, status, content);

  function render(snapshot: SkillsSnapshot): void {
    const children: HTMLElement[] = [];
    for (const skill of sortSkillItems(snapshot.skills)) {
      const row = document.createElement("article");
      row.className = "skill-row";
      const main = document.createElement("div");
      main.className = "skill-main";
      const title = document.createElement("h3");
      title.textContent = skill.name;
      const id = document.createElement("code");
      id.textContent = skill.id;
      const description = document.createElement("p");
      description.textContent = skill.description;
      const metadata = document.createElement("p");
      metadata.className = "skill-metadata";
      metadata.textContent = [
        `Source: ${skill.source}`,
        skill.version ? `Version: ${skill.version}` : undefined,
        `Tools: ${skill.requiredTools.join(", ") || "none"}`,
        `References: ${skill.references.join(", ") || "none"}`,
      ].filter(Boolean).join(" | ");
      main.append(title, id, description, metadata);

      const control = document.createElement("label");
      control.className = "skill-toggle";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = skill.enabled;
      checkbox.disabled = !skill.available;
      const label = document.createElement("span");
      label.textContent = skillStatusLabel(skill);
      control.append(checkbox, label);
      checkbox.addEventListener("change", async () => {
        checkbox.disabled = true;
        status.textContent = "Saving...";
        try {
          render(await options.api.setEnabled(skill.id, checkbox.checked));
          status.textContent = "Saved";
        } catch (error) {
          status.textContent = error instanceof Error ? error.message : String(error);
          checkbox.disabled = !skill.available;
        }
      });
      row.append(main, control);
      children.push(row);
    }

    if (snapshot.diagnostics.length > 0) {
      const diagnostics = document.createElement("section");
      diagnostics.className = "skill-diagnostics";
      const title = document.createElement("h3");
      title.textContent = "Diagnostics";
      diagnostics.append(title);
      for (const item of snapshot.diagnostics) {
        const line = document.createElement("p");
        line.textContent = `${item.source}: ${item.code} - ${item.message}`;
        diagnostics.append(line);
      }
      children.push(diagnostics);
    }
    if (children.length === 0) {
      const empty = document.createElement("p");
      empty.className = "skills-empty";
      empty.textContent = "No Skills found.";
      children.push(empty);
    }
    content.replaceChildren(...children);
  }

  async function load(reload: boolean): Promise<void> {
    reloadButton.disabled = true;
    status.textContent = reload ? "Scanning..." : "Loading...";
    try {
      const snapshot = reload ? await options.api.reload() : await options.api.list();
      render(snapshot);
      status.textContent = `${snapshot.skills.length} Skills`;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      reloadButton.disabled = false;
    }
  }

  reloadButton.addEventListener("click", () => load(true));
  return { show: () => load(false) };
}
