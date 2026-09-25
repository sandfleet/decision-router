import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const entrypoint = join(projectRoot, "dist", "src", "index.js");
const timeoutMs = 10_000;

await access(entrypoint).catch(() => {
  throw new Error(`Compiled entrypoint is missing: ${entrypoint}. Run "npm run build" first.`);
});

const env = {
  ...process.env,
  LAYA_API_URL: "http://127.0.0.1:8000",
  LAYA_AUTOSTART: "0",
  LAYA_CALIBRATION_FILE: "",
  LAYA_CONFIDENCE_THRESHOLD: "0.8",
  LAYA_SERVE_ARGS: "[]",
};
delete env.LAYA_API_KEY;
delete env.LAYA_API_TOKEN;
delete env.LAYA_MODEL;

const child = spawn(process.execPath, [entrypoint], {
  cwd: projectRoot,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
let ready = false;
let settled = false;

const childResult = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    child.kill("SIGKILL");
    reject(new Error(`Timed out after ${timeoutMs}ms waiting for the MCP server to start.\n${stderr.trim()}`));
  }, timeoutMs);

  child.stderr.on("data", chunk => {
    stderr += String(chunk);
    if (!ready && stderr.includes("Ready on stdio")) {
      ready = true;
      setTimeout(() => child.kill("SIGTERM"), 100);
    }
  });
  child.stdout.on("data", chunk => {
    stderr += String(chunk);
  });

  child.once("error", error => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    reject(new Error(`Unable to start the compiled MCP server: ${error.message}`));
  });

  child.once("exit", (code, signal) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    if (!ready) {
      reject(new Error(`MCP server exited before reporting readiness (code=${code}, signal=${signal}).\n${stderr.trim()}`));
      return;
    }
    if (code !== 0) {
      reject(new Error(`MCP server failed to shut down cleanly (code=${code}, signal=${signal}).\n${stderr.trim()}`));
      return;
    }
    resolve();
  });
});

try {
  await childResult;
  console.log("MCP runtime validation passed: server started and shut down cleanly.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
