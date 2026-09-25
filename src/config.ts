import type { ModelName } from "./types.js";

export interface LayaConfig {
  apiUrl: string;
  apiKey?: string;
  model?: ModelName;
  autostart: boolean;
  pythonExecutable: string;
  serveCommand: string;
  serveModule?: string;
  serveArgs: string[];
  preload: string;
  confidenceThreshold: number;
  calibrationFile?: string;
  requestTimeoutMs: number;
  startupTimeoutMs: number;
}

const DEFAULT_API_URL = "http://127.0.0.1:8000";
const DEFAULT_CONFIDENCE_THRESHOLD = 0.8;
const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 120_000;

const MODEL_NAMES: ModelName[] = ["english", "multilingual", "typed-decisions"];

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function parsePositiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(value)}`);
  }
  return parsed;
}

function parseConfidenceThreshold(value: string | undefined): number {
  if (value === undefined) return DEFAULT_CONFIDENCE_THRESHOLD;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`LAYA_CONFIDENCE_THRESHOLD must be a number between 0 and 1, got ${JSON.stringify(value)}`);
  }
  return parsed;
}

function parseServeArgs(value: string | undefined): string[] {
  if (value === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some(item => typeof item !== "string")) {
      throw new Error("not an array of strings");
    }
    return parsed;
  } catch (error) {
    throw new Error(
      `LAYA_SERVE_ARGS must be a JSON array of strings: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function parseModel(value: string | undefined): ModelName | undefined {
  if (value === undefined || value.toLowerCase() === "auto") return undefined;
  const normalized = value.toLowerCase();
  if (!MODEL_NAMES.includes(normalized as ModelName)) {
    throw new Error(
      `LAYA_MODEL must be one of ${MODEL_NAMES.join(", ")}, or "auto", got ${JSON.stringify(value)}`,
    );
  }
  return normalized as ModelName;
}

function normalizeApiUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`LAYA_API_URL must be a valid URL, got ${JSON.stringify(value)}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`LAYA_API_URL must use http or https, got ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new Error("LAYA_API_URL must not contain embedded credentials");
  }
  if (url.search || url.hash) {
    throw new Error("LAYA_API_URL must not contain a query string or fragment");
  }

  // A trailing slash lets URL(path, base) preserve any base path while still
  // resolving the endpoint relative to it.
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return url.toString();
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): LayaConfig {
  const pythonExecutable = envValue(env, "LAYA_PYTHON") ?? "python3";
  const serveModule = envValue(env, "LAYA_SERVE_MODULE");
  const serveCommand = envValue(env, "LAYA_SERVE_COMMAND") ?? "laya-serve";
  const serveArgs = parseServeArgs(envValue(env, "LAYA_SERVE_ARGS"));

  return {
    apiUrl: normalizeApiUrl(envValue(env, "LAYA_API_URL") ?? DEFAULT_API_URL),
    apiKey: envValue(env, "LAYA_API_KEY") ?? envValue(env, "LAYA_API_TOKEN"),
    model: parseModel(envValue(env, "LAYA_MODEL")),
    autostart: parseBoolean(envValue(env, "LAYA_AUTOSTART"), false),
    pythonExecutable,
    serveCommand,
    serveModule,
    serveArgs,
    preload: envValue(env, "LAYA_PRELOAD") ?? "0",
    confidenceThreshold: parseConfidenceThreshold(envValue(env, "LAYA_CONFIDENCE_THRESHOLD")),
    calibrationFile: envValue(env, "LAYA_CALIBRATION_FILE"),
    requestTimeoutMs: parsePositiveInteger(
      envValue(env, "LAYA_REQUEST_TIMEOUT_MS"),
      DEFAULT_REQUEST_TIMEOUT_MS,
      "LAYA_REQUEST_TIMEOUT_MS",
    ),
    startupTimeoutMs: parsePositiveInteger(
      envValue(env, "LAYA_STARTUP_TIMEOUT_MS"),
      DEFAULT_STARTUP_TIMEOUT_MS,
      "LAYA_STARTUP_TIMEOUT_MS",
    ),
  };
}

export function modelForRequest(config: LayaConfig, requested?: string): ModelName | undefined {
  if (requested === undefined) return config.model;
  const normalized = requested.toLowerCase();
  if (!MODEL_NAMES.includes(normalized as ModelName)) {
    throw new Error(`model must be one of ${MODEL_NAMES.join(", ")}, got ${JSON.stringify(requested)}`);
  }
  return normalized as ModelName;
}
