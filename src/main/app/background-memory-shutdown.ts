import type { ChatIpcRuntime } from "./register-chat-ipc.js";

export interface BeforeQuitEventLike {
  preventDefault(): void;
}

export interface AppQuitLike {
  on(channel: "before-quit", listener: (event: BeforeQuitEventLike) => void): void;
  quit(): void;
}

export function registerBackgroundMemoryShutdown(options: {
  app: AppQuitLike;
  runtime: ChatIpcRuntime;
  logger?: (message: string) => void;
}): void {
  let allowQuit = false;
  let flushStarted = false;

  options.app.on("before-quit", (event) => {
    if (allowQuit || options.runtime.pendingBackgroundTaskCount() === 0) {
      return;
    }

    event.preventDefault();
    if (flushStarted) {
      return;
    }

    flushStarted = true;
    void options.runtime.flushBackgroundTasks()
      .catch(() => {
        try {
          (options.logger ?? console.error)("[electron] background memory flush failed");
        } catch {
          // Logging must not prevent the final quit attempt.
        }
      })
      .finally(() => {
        allowQuit = true;
        options.app.quit();
      });
  });
}
