import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
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
const child = spawn(electronPath, [".", `--remote-debugging-port=${port}`], {
  cwd: process.cwd(),
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
    return {
      title: document.title,
      tabs: [...document.querySelectorAll(".view-switch-button")].map((item) => item.textContent),
      skillsVisible: !document.querySelector("#skills-view").hidden,
      skillNames: [...document.querySelectorAll(".skill-row h3")].map((item) => item.textContent),
      states: [...document.querySelectorAll(".skill-toggle span")].map((item) => item.textContent),
      status: document.querySelector(".skills-status")?.textContent,
    };
  })()`);
  if (!result.skillsVisible
    || !result.skillNames.includes("Agent Learning Tutor")
    || !result.skillNames.includes("Cyrene Original Voice")) {
    throw new Error(`Unexpected Skills view: ${JSON.stringify(result)}`);
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
}
