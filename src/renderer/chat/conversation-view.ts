import type { ConversationChangedPayload } from "../../shared/conversation-types.js";

export function mountConversationView(options: {
  root: HTMLElement;
  document?: Document;
  onCreate(): void | Promise<void>;
  onSelect(id: string): void | Promise<void>;
  onRename(id: string, title: string): void | Promise<void>;
  onRemove(id: string): void | Promise<void>;
}) {
  const document = options.document ?? window.document;
  let current: ConversationChangedPayload & { unreadConversationIds: string[] } = {
    activeConversationId: "",
    conversations: [],
    unreadConversationIds: [],
  };
  let filter = "";
  let editingId = "";

  function render(next = current): void {
    current = next;
    const header = document.createElement("div");
    header.className = "conversation-sidebar-header";
    const title = document.createElement("h2");
    title.textContent = "Conversations";
    const create = document.createElement("button");
    create.type = "button";
    create.className = "conversation-new-button";
    create.textContent = "+";
    create.title = "New conversation";
    create.setAttribute("aria-label", "New conversation");
    create.disabled = current.conversations.some(({ messageCount, hasPendingRun }) => messageCount === 0 && !hasPendingRun);
    create.addEventListener("click", () => void options.onCreate());
    header.append(title, create);

    const search = document.createElement("input");
    search.type = "search";
    search.className = "conversation-search";
    search.placeholder = "Search conversations";
    search.value = filter;
    search.addEventListener("input", () => {
      filter = search.value.trim().toLocaleLowerCase();
      render();
    });

    const list = document.createElement("div");
    list.className = "conversation-list";
    const unread = new Set(current.unreadConversationIds);
    for (const conversation of current.conversations.filter(({ title, preview }) =>
      !filter || `${title} ${preview}`.toLocaleLowerCase().includes(filter)
    )) {
      const row = document.createElement("div");
      row.className = `conversation-row${conversation.id === current.activeConversationId ? " is-active" : ""}`;
      const select = document.createElement("button");
      select.type = "button";
      select.className = "conversation-select-button";
      const rowTitle = document.createElement("strong");
      rowTitle.textContent = `${unread.has(conversation.id) ? "* " : ""}${conversation.title}`;
      const preview = document.createElement("span");
      preview.textContent = conversation.preview || "No messages yet";
      const meta = document.createElement("small");
      meta.textContent = conversation.hasPendingRun ? "Running" : new Date(conversation.updatedAt).toLocaleString();
      select.append(rowTitle, preview, meta);
      select.addEventListener("click", () => void options.onSelect(conversation.id));

      const actions = document.createElement("div");
      actions.className = "conversation-row-actions";
      if (editingId === conversation.id) {
        const editor = document.createElement("div");
        editor.className = "conversation-rename-editor";
        const input = document.createElement("input");
        input.className = "conversation-rename-input";
        input.value = conversation.title;
        input.setAttribute("aria-label", "Conversation title");
        const save = document.createElement("button");
        save.type = "button";
        save.className = "conversation-rename-save";
        save.textContent = "Save";
        save.addEventListener("click", async () => {
          const title = input.value.trim();
          if (!title) return;
          await options.onRename(conversation.id, title);
          editingId = "";
          render();
        });
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.textContent = "Cancel";
        cancel.addEventListener("click", () => { editingId = ""; render(); });
        editor.append(input, save, cancel);
        row.append(editor);
        list.append(row);
        continue;
      }
      const rename = document.createElement("button");
      rename.type = "button";
      rename.className = "conversation-rename-button";
      rename.textContent = "Edit";
      rename.title = "Rename conversation";
      rename.setAttribute("aria-label", "Rename conversation");
      rename.addEventListener("click", () => { editingId = conversation.id; render(); });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Delete";
      remove.title = "Delete conversation";
      remove.setAttribute("aria-label", "Delete conversation");
      remove.addEventListener("click", () => void options.onRemove(conversation.id));
      actions.append(rename, remove);
      row.append(select, actions);
      list.append(row);
    }
    options.root.replaceChildren(header, search, list);
  }

  return { render };
}
