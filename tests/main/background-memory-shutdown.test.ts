import { describe, expect, it, vi } from "vitest";
import type { ChatIpcRuntime } from "../../src/main/app/register-chat-ipc.js";
import {
  registerBackgroundMemoryShutdown,
  type BeforeQuitEventLike,
} from "../../src/main/app/background-memory-shutdown.js";

type BeforeQuitListener = (event: BeforeQuitEventLike) => void | Promise<void>;

interface FakeApp {
  beforeQuit?: BeforeQuitListener;
  on: (channel: "before-quit", listener: BeforeQuitListener) => void;
  quit: ReturnType<typeof vi.fn>;
}

function createFakeApp(): FakeApp {
  const app: FakeApp = {
    on: (_channel, listener) => {
      app.beforeQuit = listener;
    },
    quit: vi.fn(),
  };
  return app;
}

function createRuntime(
  pendingCount: () => number,
  beginShutdown: () => Promise<void>,
): ChatIpcRuntime {
  return {
    pendingBackgroundTaskCount: pendingCount,
    flushBackgroundTasks: beginShutdown,
    beginShutdown,
  };
}

function createEvent() {
  return { preventDefault: vi.fn() };
}

async function triggerBeforeQuit(app: FakeApp, event = createEvent()): Promise<void> {
  await app.beforeQuit?.(event);
}

describe("registerBackgroundMemoryShutdown", () => {
  it("allows Electron to quit immediately when no background work is pending", async () => {
    const app = createFakeApp();
    const beginShutdown = vi.fn(async () => undefined);
    const runtime = createRuntime(() => 0, beginShutdown);
    registerBackgroundMemoryShutdown({ app, runtime });
    const event = createEvent();

    await triggerBeforeQuit(app, event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(beginShutdown).toHaveBeenCalledOnce();
    expect(app.quit).not.toHaveBeenCalled();
  });

  it("prevents the first quit and starts only one flush while work is pending", async () => {
    const app = createFakeApp();
    let pendingCount = 1;
    let resolveFlush!: () => void;
    const flushBackgroundTasks = vi.fn(
      () => new Promise<void>((resolve) => {
        resolveFlush = resolve;
      }),
    );
    const runtime = createRuntime(() => pendingCount, flushBackgroundTasks);
    registerBackgroundMemoryShutdown({ app, runtime });
    const firstEvent = createEvent();
    const secondEvent = createEvent();

    const firstQuit = triggerBeforeQuit(app, firstEvent);
    await Promise.resolve();
    const secondQuit = triggerBeforeQuit(app, secondEvent);
    await Promise.resolve();

    expect(firstEvent.preventDefault).toHaveBeenCalledOnce();
    expect(secondEvent.preventDefault).toHaveBeenCalledOnce();
    expect(flushBackgroundTasks).toHaveBeenCalledOnce();
    expect(app.quit).not.toHaveBeenCalled();

    pendingCount = 0;
    resolveFlush();
    await Promise.all([firstQuit, secondQuit]);

    expect(app.quit).toHaveBeenCalledOnce();
  });

  it("allows a later before-quit event after the final quit is authorized", async () => {
    const app = createFakeApp();
    const runtime = createRuntime(() => 1, async () => undefined);
    registerBackgroundMemoryShutdown({ app, runtime });
    const firstEvent = createEvent();
    await triggerBeforeQuit(app, firstEvent);
    const laterEvent = createEvent();

    await triggerBeforeQuit(app, laterEvent);

    expect(firstEvent.preventDefault).toHaveBeenCalledOnce();
    expect(laterEvent.preventDefault).not.toHaveBeenCalled();
    expect(app.quit).toHaveBeenCalledOnce();
  });

  it("logs a flush rejection and still permits the final quit", async () => {
    const app = createFakeApp();
    const error = new Error("flush failed with sk-secret-value");
    const logger = vi.fn();
    const runtime = createRuntime(() => 1, async () => {
      throw error;
    });
    registerBackgroundMemoryShutdown({ app, runtime, logger });
    const event = createEvent();

    await triggerBeforeQuit(app, event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(logger).toHaveBeenCalledWith(
      "[electron] background memory flush failed",
    );
    expect(logger.mock.calls.flat().join(" ")).not.toContain("sk-secret-value");
    expect(app.quit).toHaveBeenCalledOnce();
  });
});
