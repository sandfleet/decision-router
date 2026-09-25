import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { modelForRequest, type LayaConfig } from "./config.js";
import type {
  LayaAnswer,
  LayaHealth,
  LayaQuestion,
  LayaResult,
  Logger,
} from "./types.js";

export class LayaClientError extends Error {
  readonly status?: number;
  readonly detail?: string;

  constructor(message: string, options: { status?: number; detail?: string; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "LayaClientError";
    this.status = options.status;
    this.detail = options.detail;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function detailFromPayload(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  if (typeof payload.detail === "string") return payload.detail;
  if (typeof payload.error === "string") return payload.error;
  if (isRecord(payload.error) && typeof payload.error.message === "string") {
    return payload.error.message;
  }
  return undefined;
}

function bounded(value: string, max = 1_000): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

function endpoint(baseUrl: string, path: string): string {
  return new URL(path.replace(/^\/+/, ""), baseUrl).toString();
}

function isLocalHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]" || normalized === "::1";
}

function bindHost(hostname: string): string {
  if (hostname.toLowerCase() === "localhost") return "127.0.0.1";
  return hostname.replace(/^\[/, "").replace(/\]$/, "");
}

/**
 * Small HTTP client for the official `laya-serve` API.
 *
 * The client deliberately does not log request bodies or state text. Those can
 * contain tickets, emails, or other sensitive data.
 */
export class LayaClient {
  private readonly config: LayaConfig;
  private readonly logger: Logger;
  private child: ChildProcess | undefined;
  private childError: Error | undefined;
  private readyPromise: Promise<void> | undefined;
  private closed = false;

  constructor(config: LayaConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  async health(timeoutMs = this.config.requestTimeoutMs): Promise<LayaHealth> {
    return this.requestJson<LayaHealth>("/health", { method: "GET" }, timeoutMs);
  }

  async predict(
    state: unknown,
    questions: Record<string, LayaQuestion>,
    requestedModel?: string,
  ): Promise<LayaResult> {
    if (this.closed) {
      throw new LayaClientError("Laya client is closed");
    }
    await this.ensureBackend();

    const model = modelForRequest(this.config, requestedModel);
    const body: Record<string, unknown> = { state, questions };
    if (model !== undefined) body.model = model;

    const result = await this.requestJson<LayaResult>(
      "/v1/systemone",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      this.config.requestTimeoutMs,
    );

    if (!isRecord(result) || !isRecord(result.answers)) {
      throw new LayaClientError("Laya returned an invalid response: expected an object with an answers map");
    }
    return result;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.readyPromise = undefined;
    await this.stopChild();
  }

  private async stopChild(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;

    await new Promise<void>(resolve => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(forceTimer);
        resolve();
      };
      const forceTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // The process may have exited between the check and the signal.
        }
        finish();
      }, 5_000);
      child.once("exit", finish);
      try {
        child.kill("SIGTERM");
      } catch {
        finish();
      }
    });
  }

  private async ensureBackend(): Promise<void> {
    if (!this.config.autostart) return;
    if (this.readyPromise === undefined) {
      this.readyPromise = this.startOrReuseBackend().catch(error => {
        this.readyPromise = undefined;
        throw error;
      });
    }
    await this.readyPromise;
  }

  private async startOrReuseBackend(): Promise<void> {
    if (await this.probeHealth(1_500)) {
      this.logger.debug(`Using existing Laya service at ${this.config.apiUrl}`);
      return;
    }

    const url = new URL(this.config.apiUrl);
    if (url.protocol !== "http:" || !isLocalHost(url.hostname) || url.pathname !== "/") {
      throw new LayaClientError(
        "LAYA_AUTOSTART requires LAYA_API_URL to be a local http:// root URL (for example http://127.0.0.1:8000)",
      );
    }

    this.startChild(url.port || "80", bindHost(url.hostname));
    try {
      await this.waitForHealth();
    } catch (error) {
      await this.stopChild();
      throw error;
    }
  }

  private startChild(port: string, host: string): void {
    if (this.child !== undefined) {
      throw new LayaClientError("A Laya child process is already running");
    }

    const command = this.config.serveModule === undefined
      ? this.config.serveCommand
      : this.config.pythonExecutable;
    const args = this.config.serveModule === undefined
      ? [...this.config.serveArgs]
      : ["-m", this.config.serveModule, ...this.config.serveArgs];

    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      LAYA_HOST: host,
      LAYA_PORT: port,
      LAYA_PRELOAD: this.config.preload,
    };
    if (this.config.apiKey !== undefined) childEnv.LAYA_API_KEY = this.config.apiKey;

    this.logger.debug(`Starting Laya service: ${command} (${args.length} argument${args.length === 1 ? "" : "s"})`);
    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      throw new LayaClientError(`Unable to start Laya service (${command}): ${errorText(error)}`, {
        cause: error,
      });
    }

    this.child = child;
    this.childError = undefined;
    child.stdout?.on("data", chunk => {
      const text = String(chunk).trimEnd();
      if (text) this.logger.debug(`[laya-serve] ${text}`);
    });
    child.stderr?.on("data", chunk => {
      const text = String(chunk).trimEnd();
      if (text) this.logger.error(`[laya-serve] ${text}`);
    });
    child.once("error", error => {
      this.childError = error;
      this.logger.error(`Laya service process error: ${error.message}`);
    });
    child.once("exit", (code, signal) => {
      if (this.child === child) this.child = undefined;
      if (!this.closed && code !== 0) {
        this.logger.error(`Laya service exited (code=${code ?? "null"}, signal=${signal ?? "null"})`);
      }
    });
  }

  private async waitForHealth(): Promise<void> {
    const deadline = Date.now() + this.config.startupTimeoutMs;
    let delayMs = 100;

    while (Date.now() < deadline) {
      if (this.childError !== undefined) {
        const error = this.childError;
        this.childError = undefined;
        throw new LayaClientError(`Unable to start Laya service: ${error.message}`, { cause: error });
      }
      if (this.child === undefined || this.child.exitCode !== null) {
        throw new LayaClientError("Laya service exited before becoming healthy");
      }

      const remaining = Math.max(1, deadline - Date.now());
      try {
        await this.health(Math.min(2_000, remaining));
        this.logger.debug(`Laya service is healthy at ${this.config.apiUrl}`);
        return;
      } catch (error) {
        if (error instanceof LayaClientError && (error.status === 401 || error.status === 403)) {
          throw error;
        }
        await sleep(Math.min(delayMs, Math.max(1, deadline - Date.now())));
        delayMs = Math.min(1_000, Math.floor(delayMs * 1.5));
      }
    }

    await this.stopChild();
    throw new LayaClientError(
      `Laya service did not become healthy within ${this.config.startupTimeoutMs}ms. ` +
        "Check that `laya[serve]` is installed and that the configured port is available.",
    );
  }

  private async probeHealth(timeoutMs: number): Promise<boolean> {
    try {
      await this.health(timeoutMs);
      return true;
    } catch (error) {
      // A reachable authenticated service should not be mistaken for a
      // missing one: surface its auth error instead of trying to spawn over it.
      if (error instanceof LayaClientError && (error.status === 401 || error.status === 403)) throw error;
      return false;
    }
  }

  private async requestJson<T>(
    path: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<T> {
    const url = endpoint(this.config.apiUrl, path);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (this.config.apiKey !== undefined) {
      headers.set("authorization", `Bearer ${this.config.apiKey}`);
    }

    try {
      let response: Response;
      try {
        response = await fetch(url, { ...init, headers, signal: controller.signal, redirect: "error" });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new LayaClientError(`Laya request timed out after ${timeoutMs}ms: ${url}`, { cause: error });
        }
        throw new LayaClientError(`Unable to reach Laya service at ${url}: ${errorText(error)}`, { cause: error });
      }

      const rawBody = await response.text();
      let payload: unknown = undefined;
      if (rawBody.length > 0) {
        try {
          payload = JSON.parse(rawBody);
        } catch {
          if (response.ok) {
            throw new LayaClientError(`Laya returned invalid JSON from ${url}`);
          }
          payload = undefined;
        }
      }

      if (!response.ok) {
        const rawDetail = detailFromPayload(payload) ?? bounded(rawBody || response.statusText || "request failed");
        const detail = this.config.apiKey === undefined
          ? rawDetail
          : rawDetail.split(this.config.apiKey).join("[REDACTED]");
        throw new LayaClientError(`Laya request failed (${response.status}) ${url}: ${detail}`, {
          status: response.status,
          detail,
        });
      }

      return payload as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function answerFor(result: LayaResult, questionId: string): LayaAnswer {
  const answer = result.answers[questionId];
  if (!isRecord(answer)) {
    throw new LayaClientError(`Laya response did not contain an answer for question ${JSON.stringify(questionId)}`);
  }
  return answer as LayaAnswer;
}

export function modelLabel(result: LayaResult): string | undefined {
  return typeof result.model === "string" ? result.model : undefined;
}
