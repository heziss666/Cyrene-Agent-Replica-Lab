import type {
  DeleteProfileFieldInput,
  MemoryLayer,
  SetEnabledInput,
  SetPinnedInput,
  UpdateL2Input,
  UpdateProfileFieldInput,
} from "../../shared/memory-api-types.js";
import { IPC_CHANNELS } from "../../shared/ipc-channels.js";
import type { MemoryGovernanceService } from "../memory/memory-governance.js";
import type { ChatIpcRuntime } from "./register-chat-ipc.js";

type MemoryIpcHandler = (event: unknown, payload?: unknown) => Promise<unknown>;

export interface MemoryIpcMainLike {
  handle(channel: string, handler: MemoryIpcHandler): void;
  removeHandler(channel: string): void;
}

export interface MemoryIpcRuntime {
  beginShutdown(): Promise<void>;
  pendingOperationCount(): number;
  dispose(): void;
}

export interface RegisterMemoryIpcOptions {
  ipcMain: MemoryIpcMainLike;
  governance: MemoryGovernanceService;
  afterRestoreL2?: (id: string) => Promise<void>;
}

const INVALID_PAYLOAD_MESSAGE = "Invalid memory IPC payload";
const OPERATION_FAILED_MESSAGE = "Memory operation failed";
const SHUTDOWN_MESSAGE = "Memory IPC is shutting down";
const MAX_CONTENT_LENGTH = 2_000;

const L0_STRING_FIELDS = new Set(["preferredName", "occupation", "language"]);
const L0_ARRAY_FIELDS = new Set(["longTermInterests", "permanentNotes"]);
const L1_STRING_FIELDS = new Set(["currentProject"]);
const L1_ARRAY_FIELDS = new Set(["recentGoals", "recentPreferences"]);
const MEMORY_CHANNELS = Object.values(IPC_CHANNELS.memory);

interface ActiveRegistration {
  token: object;
  beginShutdown(): Promise<void>;
}

const activeRegistrations = new WeakMap<MemoryIpcMainLike, ActiveRegistration>();

export function combineIpcShutdownRuntimes(
  chatRuntime: ChatIpcRuntime,
  memoryRuntime: MemoryIpcRuntime,
): ChatIpcRuntime {
  let shutdownPromise: Promise<void> | undefined;

  function beginShutdown(): Promise<void> {
    if (!shutdownPromise) {
      const chatShutdown = captureShutdown(() => chatRuntime.beginShutdown());
      const memoryShutdown = captureShutdown(() => memoryRuntime.beginShutdown());
      shutdownPromise = Promise.allSettled([chatShutdown, memoryShutdown]).then((results) => {
        if (results.some((result) => result.status === "rejected")) {
          throw new Error("Background shutdown failed");
        }
      });
    }
    return shutdownPromise;
  }

  return {
    beginShutdown,
    flushBackgroundTasks: beginShutdown,
    pendingBackgroundTaskCount: () => (
      chatRuntime.pendingBackgroundTaskCount() + memoryRuntime.pendingOperationCount()
    ),
    inspectRestoredMemory: (id) => chatRuntime.inspectRestoredMemory?.(id) ?? Promise.resolve(),
  };
}

export function registerMemoryIpc(
  options: RegisterMemoryIpcOptions,
): MemoryIpcRuntime {
  const { ipcMain, governance } = options;
  const acceptedOperations = new Set<Promise<unknown>>();
  const registrationToken = {};
  let shuttingDown = false;
  let shutdownPromise: Promise<void> | undefined;
  let disposed = false;

  void activeRegistrations.get(ipcMain)?.beginShutdown();
  activeRegistrations.set(ipcMain, { token: registrationToken, beginShutdown });
  for (const channel of MEMORY_CHANNELS) {
    ipcMain.removeHandler(channel);
  }

  function runOperation<T>(task: () => Promise<T>): Promise<T> {
    if (shuttingDown) {
      return Promise.reject(new Error(SHUTDOWN_MESSAGE));
    }

    const operation = Promise.resolve().then(task);
    acceptedOperations.add(operation);
    void operation.then(
      () => acceptedOperations.delete(operation),
      () => acceptedOperations.delete(operation),
    );
    return operation;
  }

  async function invokeGovernance<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch {
      throw new Error(OPERATION_FAILED_MESSAGE);
    }
  }

  function registerHandler<T>(
    channel: string,
    parse: (payload: unknown) => T,
    invoke: (input: T) => Promise<unknown>,
  ): void {
    ipcMain.handle(channel, (_event, payload) => runOperation(async () => {
      let input: T;
      try {
        input = parse(payload);
      } catch {
        throw new Error(INVALID_PAYLOAD_MESSAGE);
      }
      return invokeGovernance(() => invoke(input));
    }));
  }

  registerHandler(
    IPC_CHANNELS.memory.getSnapshot,
    parseNoPayload,
    () => governance.snapshot(),
  );
  registerHandler(
    IPC_CHANNELS.memory.updateProfileField,
    parseUpdateProfileField,
    (input) => governance.updateProfileField(input),
  );
  registerHandler(
    IPC_CHANNELS.memory.updateL2,
    parseUpdateL2,
    (input) => governance.updateL2(input),
  );
  registerHandler(
    IPC_CHANNELS.memory.deleteProfileField,
    parseDeleteProfileField,
    (input) => governance.deleteProfileField(input),
  );
  registerHandler(
    IPC_CHANNELS.memory.deleteL2,
    parseId,
    (id) => governance.deleteL2(id),
  );
  registerHandler(
    IPC_CHANNELS.memory.setPinned,
    parseSetPinned,
    (input) => governance.setL2Pinned(input),
  );
  registerHandler(
    IPC_CHANNELS.memory.setEnabled,
    parseSetEnabled,
    (input) => governance.setL2Enabled(input),
  );
  registerHandler(
    IPC_CHANNELS.memory.restoreL2,
    parseId,
    async (id) => {
      const result = await governance.restoreL2(id);
      if (result.ok) {
        try {
          await options.afterRestoreL2?.(id);
        } catch {
          // Restore succeeds even when its best-effort conflict inspection cannot run.
        }
      }
      return result;
    },
  );
  registerHandler(
    IPC_CHANNELS.memory.clearLayer,
    parseLayer,
    (layer) => governance.clearLayer(layer),
  );
  registerHandler(
    IPC_CHANNELS.memory.getAuditReport,
    parseNoPayload,
    () => governance.audit(),
  );

  function beginShutdown(): Promise<void> {
    shuttingDown = true;
    shutdownPromise ??= (async () => {
      while (acceptedOperations.size > 0) {
        await Promise.allSettled([...acceptedOperations]);
      }
    })();
    return shutdownPromise;
  }

  function dispose(): void {
    if (disposed || activeRegistrations.get(ipcMain)?.token !== registrationToken) return;
    disposed = true;
    void beginShutdown();
    activeRegistrations.delete(ipcMain);
    for (const channel of MEMORY_CHANNELS) {
      ipcMain.removeHandler(channel);
    }
  }

  return {
    beginShutdown,
    pendingOperationCount: () => acceptedOperations.size,
    dispose,
  };
}

function parseNoPayload(payload: unknown): undefined {
  if (payload !== undefined) invalidPayload();
  return undefined;
}

function parseUpdateProfileField(payload: unknown): UpdateProfileFieldInput {
  const record = exactRecord(payload, ["layer", "field", "value"]);
  const layer = dataValue(record, "layer");
  const field = dataValue(record, "field");
  const value = dataValue(record, "value");
  if (!isProfileLayer(layer) || typeof field !== "string") invalidPayload();

  const expectsArray = isArrayProfileField(layer, field);
  const expectsString = isStringProfileField(layer, field);
  if (!expectsArray && !expectsString) invalidPayload();
  if (expectsString) {
    if (!isValidContent(value)) invalidPayload();
    return { layer, field, value } as UpdateProfileFieldInput;
  }
  if (!Array.isArray(value)) invalidPayload();
  const values = [...value];
  if (!values.every(isValidContent)) invalidPayload();
  return { layer, field, value: values } as UpdateProfileFieldInput;
}

function parseUpdateL2(payload: unknown): UpdateL2Input {
  const record = exactRecord(payload, ["id", "content"]);
  const id = dataValue(record, "id");
  const content = dataValue(record, "content");
  if (!isValidId(id) || !isValidContent(content)) invalidPayload();
  return { id, content };
}

function parseDeleteProfileField(payload: unknown): DeleteProfileFieldInput {
  const record = exactRecord(payload, ["layer", "field"]);
  const layer = dataValue(record, "layer");
  const field = dataValue(record, "field");
  if (!isProfileLayer(layer) || typeof field !== "string") invalidPayload();
  if (!isArrayProfileField(layer, field) && !isStringProfileField(layer, field)) {
    invalidPayload();
  }
  return { layer, field } as DeleteProfileFieldInput;
}

function parseSetPinned(payload: unknown): SetPinnedInput {
  const record = exactRecord(payload, ["id", "pinned"]);
  const id = dataValue(record, "id");
  const pinned = dataValue(record, "pinned");
  if (!isValidId(id) || typeof pinned !== "boolean") invalidPayload();
  return { id, pinned };
}

function parseSetEnabled(payload: unknown): SetEnabledInput {
  const record = exactRecord(payload, ["id", "enabled"]);
  const id = dataValue(record, "id");
  const enabled = dataValue(record, "enabled");
  if (!isValidId(id) || typeof enabled !== "boolean") invalidPayload();
  return { id, enabled };
}

function parseId(payload: unknown): string {
  if (!isValidId(payload)) invalidPayload();
  return payload;
}

function parseLayer(payload: unknown): MemoryLayer {
  if (payload !== "L0" && payload !== "L1" && payload !== "L2") invalidPayload();
  return payload;
}

function exactRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalidPayload();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalidPayload();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expectedKeys.length
    || !keys.every((key) => typeof key === "string" && expectedKeys.includes(key))) {
    invalidPayload();
  }
  return value as Record<string, unknown>;
}

function dataValue(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor || !("value" in descriptor)) invalidPayload();
  return descriptor.value;
}

function isProfileLayer(value: unknown): value is "L0" | "L1" {
  return value === "L0" || value === "L1";
}

function isStringProfileField(layer: "L0" | "L1", field: string): boolean {
  return layer === "L0" ? L0_STRING_FIELDS.has(field) : L1_STRING_FIELDS.has(field);
}

function isArrayProfileField(layer: "L0" | "L1", field: string): boolean {
  return layer === "L0" ? L0_ARRAY_FIELDS.has(field) : L1_ARRAY_FIELDS.has(field);
}

function isValidId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidContent(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= MAX_CONTENT_LENGTH;
}

function invalidPayload(): never {
  throw new Error(INVALID_PAYLOAD_MESSAGE);
}

function captureShutdown(shutdown: () => Promise<void>): Promise<void> {
  try {
    return Promise.resolve(shutdown());
  } catch {
    return Promise.reject(new Error("Background shutdown failed"));
  }
}
