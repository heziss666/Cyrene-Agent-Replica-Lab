export interface ActivityDrawerElement {
  hidden: boolean;
  classList: { toggle(name: string, force?: boolean): void };
  setAttribute(name: string, value: string): void;
}

interface ActivityDrawerOptions {
  drawer: ActivityDrawerElement;
  toggle: ActivityDrawerElement;
}

export function createActivityDrawer({ drawer, toggle }: ActivityDrawerOptions) {
  let isOpen = false;

  function render(): void {
    drawer.hidden = !isOpen;
    drawer.classList.toggle("is-open", isOpen);
    drawer.setAttribute("aria-hidden", String(!isOpen));
    toggle.setAttribute("aria-expanded", String(isOpen));
    if (isOpen) toggle.classList.toggle("has-attention", false);
  }

  function open(): void { isOpen = true; render(); }
  function close(): void { isOpen = false; render(); }
  function setAttention(value: boolean): void {
    toggle.classList.toggle("has-attention", value && !isOpen);
  }

  render();
  return { open, close, toggle: () => isOpen ? close() : open(), setAttention };
}
