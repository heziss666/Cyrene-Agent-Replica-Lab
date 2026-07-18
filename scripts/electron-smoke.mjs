import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import electronPath from "electron";

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function rendererTarget(port) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
      const page = targets.find((target) => target.type === "page");
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // Electron may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Electron renderer did not expose a debugging target");
}

function evaluate(webSocketUrl, expression) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Electron smoke evaluation timed out"));
    }, 10_000);
    socket.addEventListener("error", () => reject(new Error("CDP connection failed")));
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: { expression, awaitPromise: true, returnByValue: true },
      }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      clearTimeout(timeout);
      socket.close();
      if (message.error || message.result?.exceptionDetails) {
        const detail = message.error?.message
          ?? message.result?.exceptionDetails?.exception?.description
          ?? message.result?.exceptionDetails?.text
          ?? "unknown error";
        reject(new Error(`Electron renderer evaluation failed: ${detail}`));
        return;
      }
      resolve(message.result.result.value);
    });
  });
}

const port = await freePort();
const temporaryRoot = await mkdtemp(join(tmpdir(), "cyrene-electron-smoke-"));
const electronData = join(temporaryRoot, "user-data");
const fixtureOutput = join(temporaryRoot, "mcp-output");
const fixtureConfig = {
  id: "electron-smoke",
  name: "Electron Smoke MCP",
  enabled: true,
  trust: "ask-sensitive",
  toolOverrides: {},
  transport: "stdio",
  command: process.execPath,
  args: [
    resolve("node_modules/tsx/dist/cli.mjs"),
    resolve("tests/fixtures/mcp-test-server.ts"),
  ],
  env: { MCP_TEST_DIR: "${MCP_TEST_DIR}" },
};
const child = spawn(electronPath, [
  ".",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${electronData}`,
], {
  cwd: process.cwd(),
  env: { ...process.env, MCP_TEST_DIR: fixtureOutput },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

try {
  const target = await rendererTarget(port);
  const result = await evaluate(target.webSocketDebuggerUrl, `(async () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (document.querySelector("#skills-view-button") && window.cyrene?.skills) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const skillsButton = document.querySelector("#skills-view-button");
    if (!skillsButton || !window.cyrene?.skills) throw new Error("Renderer API did not become ready");
    skillsButton.click();
    await new Promise((resolve) => setTimeout(resolve, 700));
    const skillsResult = {
      title: document.title,
      tabs: [...document.querySelectorAll(".view-switch-button")].map((item) => item.textContent),
      skillsVisible: !document.querySelector("#skills-view").hidden,
      skillNames: [...document.querySelectorAll(".skill-row h3")].map((item) => item.textContent),
      states: [...document.querySelectorAll(".skill-toggle span")].map((item) => item.textContent),
      status: document.querySelector(".skills-status")?.textContent,
    };
    const mcpConfig = ${JSON.stringify(fixtureConfig)};
    await window.cyrene.mcp.add(mcpConfig);
    document.querySelector("#mcp-view-button").click();
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (document.querySelectorAll(".mcp-tool-row").length === 3) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const mcpResult = {
      visible: !document.querySelector("#mcp-view").hidden,
      serverNames: [...document.querySelectorAll(".mcp-server-row h3")].map((item) => item.textContent),
      metadata: [...document.querySelectorAll(".mcp-metadata")].map((item) => item.textContent),
      toolNames: [...document.querySelectorAll(".mcp-tool-row code")].map((item) => item.textContent),
      noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    };
    await window.cyrene.mcp.remove(mcpConfig.id);
    const schedulerInput = {
      name: "Electron Smoke Task", prompt: "Do not run automatically",
      schedule: { kind: "once", runAt: "2099-01-01T00:00:00.000Z" },
      timezone: "UTC", missedRunPolicy: "skip", enabled: true,
    };
    const scheduledTask = await window.cyrene.scheduler.createTask(schedulerInput);
    document.querySelector("#scheduler-view-button").click();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const schedulerResult = {
      visible: !document.querySelector("#scheduler-view").hidden,
      taskNames: [...document.querySelectorAll(".scheduler-task-row h3")].map((item) => item.textContent),
    };
    await window.cyrene.scheduler.removeTask(scheduledTask.id);
    return { ...skillsResult, mcp: mcpResult, scheduler: schedulerResult };
  })()`);
  if (!result.skillsVisible
    || !result.skillNames.includes("Agent Learning Tutor")
    || !result.skillNames.includes("Cyrene Original Voice")) {
    throw new Error(`Unexpected Skills view: ${JSON.stringify(result)}`);
  }
  if (!result.mcp.visible
    || !result.mcp.serverNames.includes("Electron Smoke MCP")
    || !result.mcp.metadata.some((value) => value.includes("Connected") && value.includes("3 tools"))
    || !["echo", "read_demo", "write_demo"].every((name) => result.mcp.toolNames.includes(name))
    || !result.mcp.noHorizontalOverflow) {
    throw new Error(`Unexpected MCP view: ${JSON.stringify(result.mcp)}`);
  }
  if (!result.scheduler.visible || !result.scheduler.taskNames.includes("Electron Smoke Task")) {
    throw new Error(`Unexpected Scheduler view: ${JSON.stringify(result.scheduler)}`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  if (stderr.trim()) process.stderr.write(stderr);
  throw error;
} finally {
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    child.kill("SIGTERM");
  }
  if (child.exitCode === null) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 2_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  await rm(temporaryRoot, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
