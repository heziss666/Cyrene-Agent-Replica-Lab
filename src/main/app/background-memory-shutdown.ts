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

  function logFlushFailure(): void {
    try {
      (options.logger ?? console.error)("[electron] background memory flush failed");
    } catch {
      // Logging must not prevent the final quit attempt.
    }
  }

  options.app.on("before-quit", (event) => {
    if (allowQuit) {
      return;
    }

    if (flushStarted) {
      event.preventDefault();
      return;
    }

    const shutdown = options.runtime.beginShutdown();
    if (options.runtime.pendingBackgroundTaskCount() === 0) {
      void shutdown.catch(logFlushFailure);
      return;
    }

    event.preventDefault();
    flushStarted = true;
    void shutdown
      .catch(logFlushFailure)
      .finally(() => {
        allowQuit = true;
        options.app.quit();
      });
  });
}
