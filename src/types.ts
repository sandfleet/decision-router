export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type LayaQuestionType = "choice" | "score" | "noul";

/** A question definition accepted by Laya's /v1/systemone endpoint. */
export interface LayaQuestion {
  type: LayaQuestionType;
  instructions: string;
  criteria?: unknown;
  labels?: Record<string, string>;
  [key: string]: unknown;
}

/** The common shape returned by Laya for all three decision primitives. */
export interface LayaAnswer {
  type: string;
  choice?: string;
  score?: number;
  noul?: number;
  probabilities?: Record<string, number>;
  confidence?: number;
  answer_confidence?: number;
  legend?: Record<string, unknown>;
  action?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface LayaUsage {
  input_tokens?: number;
  output_tokens?: number;
  [key: string]: unknown;
}

export interface LayaResult {
  model?: string;
  answers: Record<string, LayaAnswer>;
  usage?: LayaUsage;
  routing?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface LayaHealth {
  status?: string;
  loaded?: string[];
  device?: string;
  [key: string]: unknown;
}

export type ModelName = "english" | "multilingual" | "typed-decisions";

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}
